import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { open, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalBroadcaster } from "../src/broadcast.js";
import { formatGrains } from "../src/amount.js";
import { deriveAddress } from "../src/keys.js";
import { buildDraft, decodeTransaction, fromHex } from "../src/transaction.js";
import { createVault } from "../src/vault.js";
import { createLocalRpc } from "./local-rpc.js";
import { startSimnetBridge } from "./simnet-bridge.js";

// A fixed public fixture on a fresh local simnet. It does not accept a user seed, an existing data directory, or a remote RPC.
const args = process.argv.slice(2);
const option = args.find((arg) => arg.startsWith("--"));
const binaryArg = args.find((arg) => !arg.startsWith("--"));
if (!binaryArg || args.filter((arg) => !arg.startsWith("--")).length !== 1 || args.length > 2
  || (option && !["--fixture-auto-confirm", "--serve"].includes(option))) {
  throw new Error("Usage: node scripts/local-chain.js /absolute/path/to/pearld [--fixture-auto-confirm | --serve]");
}
const binary = resolve(binaryArg);
const network = "Pearl simnet";
const fixture = JSON.parse(await readFile(new URL("../src/pearl-v1.5.5.json", import.meta.url)));
const seed = fromHex(fixture.seedHex);
const sourceAddress = deriveAddress(seed, 0, 0, network);
const destination = deriveAddress(seed, 0, 1, network);
const changeAddress = deriveAddress(seed, 1, 0, network);
seed.fill(0);
await mkdir("artifacts", { recursive: true });
const runDir = await mkdtemp(resolve("artifacts/p4-simnet-"));
const rpcPort = await new Promise((done, reject) => {
  const server = createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => done(port)); });
});
const password = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const config = `${runDir}/node.conf`;
await writeFile(config, ["simnet=1", "nolisten=1", "nodnsseed=1", "noonion=1", "notls=1", "txindex=1",
  `rpclisten=127.0.0.1:${rpcPort}`, "rpcuser=local-fixture", `rpcpass=${password}`,
  `datadir=${runDir}/data`, `logdir=${runDir}/logs`, `miningaddr=${sourceAddress}`].join("\n") + "\n", { mode: 0o600 });
const logfile = await open(`${runDir}/node.log`, "w", 0o600);
const child = spawn(binary, [`--configfile=${config}`], { stdio: ["ignore", logfile.fd, logfile.fd] });
const stopped = once(child, "exit").catch(() => {});
let startError;
child.on("error", (error) => { startError = error; });
const rpc = createLocalRpc({ network, url: `http://127.0.0.1:${rpcPort}/`,
  authorization: `Basic ${Buffer.from(`local-fixture:${password}`).toString("base64")}`, timeoutMs: 30000 });
let vault;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (startError || child.exitCode !== null) throw new Error("Local node failed to start. Check this run's node.log");
    try { await rpc.assertChain(); ready = true; break; } catch { await delay(100); }
  }
  if (!ready) throw new Error("Local node is not ready");
  assert.equal(await rpc.call("getconnectioncount"), 0);
  console.log("Started an isolated Pearl simnet (a light test proof, not a regtest proof chain).");
  const hashes = await rpc.call("generate", [101]);
  assert.equal(hashes.length, 101);
  const block = await rpc.call("getblock", [hashes[0], 1]);
  const coinbaseId = block.tx[0];
  const prevTxHex = await rpc.call("getrawtransaction", [coinbaseId, 0]);
  const previous = decodeTransaction(prevTxHex);
  const unspent = await rpc.call("gettxout", [coinbaseId, 0, true]);
  assert.ok(unspent.confirmations >= 100);
  assert.equal(previous.coinbase, true);
  const draft = buildDraft({ network, sourceAddress, sourcePath: { branch: 0, index: 0 }, destination,
    changeAddress, changeIndex: 0, amount: "1", feeRate: 2, maxFee: "0.01",
    utxos: [{ txid: coinbaseId, vout: 0, value: previous.outputs[0].value, confirmations: unspent.confirmations, prevTxHex }] });
  if (option === "--serve") {
    const bridge = await startSimnetBridge({ rpc, draft });
    const pairing = `${runDir}/pairing.json`;
    try {
      await writeFile(pairing, JSON.stringify({ url: bridge.url, token: bridge.token, session: bridge.id }) + "\n", { mode: 0o600 });
      console.log(`Local bridge ready: ${bridge.url}; pairing file: ${pairing}. Press Ctrl+C to stop.`);
      await new Promise((done) => {
        const stop = () => { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); done(); };
        process.once("SIGINT", stop); process.once("SIGTERM", stop); stopped.then(stop);
      });
    } finally { await bridge.close(); await rm(pairing, { force: true }); }
  } else {
    let encrypted;
    vault = createVault({ network, storage: { async getVault() { return encrypted; }, async setVault(value) { encrypted = value; } },
      locks: { request(_name, _options, work) { return work(); } } });
    await vault.init(); await vault.save("hex", fixture.seedHex, password);
    const signed = vault.signTransaction(draft);
    assert.equal(vault.status.unlocked, false);
    const journal = `${runDir}/broadcast.json`;
    const store = {
      async get(key) { try { return JSON.parse(await readFile(journal, "utf8"))[key]; } catch (error) { if (error.code === "ENOENT") return null; throw error; } },
      async put(key, value) {
        await writeFile(`${journal}.tmp`, JSON.stringify({ [key]: value }) + "\n", { mode: 0o600 });
        await rename(`${journal}.tmp`, journal);
      },
    };
    let serial = Promise.resolve();
    let sends = 0;
    const broadcaster = createLocalBroadcaster({ network, store,
      withLock(_key, work) { const next = serial.then(work); serial = next.catch(() => {}); return next; },
      transport: { preflight: rpc.preflight, lookup: rpc.lookup, async send(hex) { sends += 1; return rpc.send(hex); } } });
    const prl = (grain) => `${formatGrains(BigInt(grain))} PRL`;
    console.log([`Network: ${network}`, `Source: ${sourceAddress}`, `Destination: ${destination}`, `Amount: ${prl(draft.payment)}`,
      `Fee: ${prl(draft.fee)}; ${draft.feeRate} grain/vB; ${draft.vsize} vB`,
      `Change: ${prl(draft.change)} → ${changeAddress}`, `Transaction ID: ${signed.txid}`].join("\n"));
    let confirmedTxid;
    if (option === "--fixture-auto-confirm") {
      console.log("Fixed public fixture auto-confirm: confirming only the transaction built from coins mined by this process.");
      confirmedTxid = signed.txid;
    } else {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try { confirmedTxid = await prompt.question("Review the summary above. Enter the full transaction ID to confirm the local broadcast (any other input cancels): "); }
      finally { prompt.close(); }
    }
    if (confirmedTxid !== signed.txid) { console.log("Cancelled. Not broadcast."); }
    else {
      const submitted = await broadcaster.submit({ draft, signed, confirmedTxid });
      console.log(`Broadcast status: ${submitted.status}`);
      assert.equal(submitted.status, "broadcast");
      await broadcaster.submit({ draft, signed, confirmedTxid });
      assert.equal(sends, 1, "The same transaction must not be sent twice");
      const mined = await rpc.call("generate", [1]);
      const status = await broadcaster.refresh(signed.txid);
      assert.equal(status.status, "broadcast"); assert.equal(status.confirmations, 1);
      assert.equal(await rpc.call("gettxout", [coinbaseId, 0, true]), null);
      const received = await rpc.call("gettxout", [signed.txid, 0, true]);
      assert.equal(received.scriptPubKey.hex, draft.outputs[0].script);
      const chainRaw = await rpc.call("getrawtransaction", [signed.txid, 0]);
      assert.equal(chainRaw, signed.rawHex);
      assert.equal(decodeTransaction(chainRaw).outputs[0].value, draft.payment);
      assert.equal(await rpc.call("getconnectioncount"), 0);
      const result = { network, sourceCommit: fixture.sourceCommit, nodeBinary: binary, status: status.status,
        txid: signed.txid, confirmations: status.confirmations, block: mined[0], fee: signed.fee, vsize: signed.vsize, sends,
        fundedWith: "newly generated local test coins", runDir };
      await writeFile("artifacts/p4-local-result.json", JSON.stringify(result, null, 2) + "\n");
      console.log("Local chain check passed: 1 confirmation in a block, previous output spent, destination script, amount, and signed hex match, send count is 1.");
    }
  }
} finally {
  vault?.lock();
  await rm(config, { force: true });
  if (child.exitCode === null && !startError) {
    child.kill("SIGINT");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    try { await stopped; } finally { clearTimeout(timer); }
  }
  await logfile.close();
}
