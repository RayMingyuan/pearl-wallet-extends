import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createLocalBroadcaster, createMainnetBroadcaster } from "../src/broadcast.js";
import { deriveAddress, signTaprootHashes } from "../src/keys.js";
import { getNetwork } from "../src/networks.js";
import { buildDraft, decodeTransaction, finalizeTransaction, fromHex, signatureHashes, taprootScript, verifySignedTransaction } from "../src/transaction.js";
import { createVault } from "../src/vault.js";
import { validatePearlAddress, validatePearlMainnetAddress } from "../src/address.js";

const keys = JSON.parse(readFileSync(new URL("../src/pearl-v1.5.5.json", import.meta.url)));
const seed = fromHex(keys.seedHex);
const network = "Pearl simnet";
const sourceAddress = deriveAddress(seed, 0, 0, network);
const sourceScript = taprootScript(sourceAddress, network);
const raw = `0200000001${"11".repeat(32)}0000000000ffffffff01a08601000000000022${sourceScript}00000000`;
const draft = buildDraft({ network, sourceAddress, sourcePath: { branch: 0, index: 0 },
  destination: deriveAddress(seed, 0, 1, network), changeAddress: deriveAddress(seed, 1, 0, network), changeIndex: 0,
  amount: "0.0005", feeRate: 2, maxFee: "0.01",
  utxos: [{ txid: decodeTransaction(raw).txid, vout: 0, value: "100000", confirmations: 10, prevTxHex: raw }] });
const signed = finalizeTransaction(draft, signTaprootHashes(seed, 0, 0, signatureHashes(draft), globalThis.crypto, network));
const confirmed = { draft, signed, confirmedTxid: signed.txid };

function harness(options = {}) {
  const records = options.records || new Map();
  let serial = Promise.resolve();
  let sends = 0; let preflights = 0; let lookups = 0;
  const deps = { network, store: { async get(key) { return records.get(key); }, async put(key, value) { records.set(key, value); } },
    withLock(_key, work) { const next = serial.then(work); serial = next.catch(() => {}); return next; },
    transport: { async preflight() { preflights += 1; return options.preflight ? options.preflight() : true; },
      async send() { sends += 1; return options.send ? options.send() : signed.txid; },
      async lookup() { lookups += 1; return options.lookup ? options.lookup() : null; } } };
  const broadcaster = createLocalBroadcaster(deps);
  return { broadcaster, deps, records, get sends() { return sends; }, get preflights() { return preflights; }, get lookups() { return lookups; } };
}

test("local derivation matches official network vectors and rejects mixed networks", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/pearl-local-networks-v1.5.5.json", import.meta.url)));
  assert.equal(fixture.sourceCommit, keys.sourceCommit);
  for (const vector of fixture.vectors) {
    const name = `Pearl ${vector.chain}`;
    assert.equal(getNetwork(name).coinType, vector.coinType);
    assert.deepEqual([[0, 0], [0, 1], [1, 0]].map(([branch, index]) => deriveAddress(seed, branch, index, name)), vector.addresses);
    assert.equal(validatePearlAddress(vector.addresses[0], name).ok, true);
    assert.equal(validatePearlMainnetAddress(vector.addresses[0]).ok, false);
    assert.equal(validatePearlAddress(keys.vectors[0].address, name).ok, false);
  }
  assert.notEqual(sourceAddress.slice(5), keys.vectors[0].address.slice(4), "coin type 改变公钥，而非仅替换 HRP");
  assert.throws(() => getNetwork("testnet"));
  assert.throws(() => createLocalBroadcaster({ network: "Pearl mainnet" }), /unsupportedChain/);
  assert.throws(() => createMainnetBroadcaster({ network }), /unsupportedMainnet/);
  assert.doesNotThrow(() => createMainnetBroadcaster({
    network: "Pearl mainnet",
    store: { async get() { return null; }, async put() {} },
    withLock(_key, work) { return work(); },
    transport: { async preflight() { return true; }, async send() { return signed.txid; }, async lookup() { return null; } },
  }));
  assert.throws(() => buildDraft({ ...draft, destination: keys.vectors[0].address }), /taprootOnly/);
});

test("broadcast requires an exact confirmed transaction and rechecks signed bytes", async () => {
  const h = harness();
  await assert.rejects(() => h.broadcaster.submit({ ...confirmed, confirmedTxid: "" }), /confirmTxid/);
  await assert.rejects(() => h.broadcaster.submit({ ...confirmed, draft: { ...draft, network: "Pearl regtest" } }), /draftNetworkMismatch/);
  const altered = { ...signed, rawHex: signed.rawHex.replace("50c3000000000000", "51c3000000000000") };
  assert.throws(() => verifySignedTransaction(draft, altered), /signedDraftMismatch/);
  await assert.rejects(() => h.broadcaster.submit({ ...confirmed, signed: { ...signed, txid: "00".repeat(32) } }), /signedDraftMismatch/);
  assert.equal(h.preflights, 0); assert.equal(h.sends, 0); assert.equal(h.records.size, 0);
});

test("parallel and repeated submissions send once, including after controller restart", async () => {
  const h = harness({ lookup() { return { txid: signed.txid, confirmations: 0 }; } });
  const results = await Promise.all([h.broadcaster.submit(confirmed), h.broadcaster.submit(confirmed)]);
  assert.ok(results.every((result) => result.status === "broadcast"));
  assert.equal(h.sends, 1); assert.equal(h.preflights, 1);
  const restarted = createLocalBroadcaster(h.deps);
  assert.equal((await restarted.submit(confirmed)).status, "broadcast");
  assert.equal(h.sends, 1);
  assert.deepEqual(Object.keys(results[0]).sort(), ["confirmations", "network", "status", "txid"]);
});

test("an echoed txid stays unknown until lookup confirms it", async () => {
  const h = harness();
  assert.equal((await h.broadcaster.submit(confirmed)).status, "unknown");
  assert.equal(h.sends, 1);
  assert.equal(h.lookups, 1);
  const confirmedLookup = harness({ lookup() { return { txid: signed.txid, confirmations: 0 }; } });
  assert.equal((await confirmedLookup.broadcaster.submit(confirmed)).status, "broadcast");
  assert.equal(confirmedLookup.lookups, 1);
});

test("preflight rejection is failed; no send or automatic retry occurs", async () => {
  const h = harness({ preflight() { return false; } });
  assert.equal((await h.broadcaster.submit(confirmed)).status, "failed");
  assert.equal((await h.broadcaster.submit(confirmed)).status, "failed");
  assert.equal((await h.broadcaster.refresh(signed.txid)).status, "failed");
  assert.equal(h.sends, 0); assert.equal(h.preflights, 1); assert.equal(h.lookups, 1);
});

test("a preflight rejection for an already known transaction is reconciled without sending", async () => {
  const h = harness({ preflight() { return false; }, lookup() { return { txid: signed.txid, confirmations: 2 }; } });
  const result = await h.broadcaster.submit(confirmed);
  assert.equal(result.status, "broadcast"); assert.equal(result.confirmations, 2);
  assert.equal(h.sends, 0);
  const unavailable = harness({ preflight() { return false; }, lookup() { throw new Error("node unavailable"); } });
  assert.equal((await unavailable.broadcaster.submit(confirmed)).status, "unknown");
  assert.equal(unavailable.sends, 0);
});

test("lost response remains unknown until lookup finds the tx; it never resends", async () => {
  let found = false;
  const h = harness({ send() { throw new Error("response lost after acceptance"); },
    lookup() { return found ? { txid: signed.txid, confirmations: 1 } : null; } });
  assert.equal((await h.broadcaster.submit(confirmed)).status, "unknown");
  assert.equal((await h.broadcaster.refresh(signed.txid)).status, "unknown");
  const restarted = createLocalBroadcaster(h.deps);
  assert.equal((await restarted.submit(confirmed)).status, "unknown");
  assert.equal(h.sends, 1);
  found = true;
  assert.equal((await restarted.refresh(signed.txid)).status, "broadcast");
  assert.equal((await restarted.refresh(signed.txid)).confirmations, 1);
  assert.equal(h.sends, 1);
});

test("wrong or malformed responses cannot establish acceptance", async () => {
  for (const send of [() => "00".repeat(32), () => null]) {
    const h = harness({ send, lookup() { return { txid: "00".repeat(32), confirmations: 4 }; } });
    assert.equal((await h.broadcaster.submit(confirmed)).status, "unknown");
    assert.equal((await h.broadcaster.refresh(signed.txid)).status, "unknown");
    assert.equal(h.sends, 1);
  }
  const h = harness({ preflight() { throw new Error("timeout"); } });
  assert.equal((await h.broadcaster.submit(confirmed)).status, "unknown");
  assert.equal(h.sends, 0);
});

test("journal failure or corruption blocks network writes", async () => {
  const h = harness();
  h.deps.store.put = async () => { throw new Error("disk unavailable"); };
  await assert.rejects(() => h.broadcaster.submit(confirmed), /disk/);
  assert.equal(h.preflights, 0); assert.equal(h.sends, 0);
  h.records.set(`simnet:${signed.txid}`, { network, txid: signed.txid, status: "unsent", confirmations: 0 });
  await assert.rejects(() => h.broadcaster.submit(confirmed), /recordCorrupt/);
  assert.equal(h.sends, 0);
});

test("mainnet vault rejects a local draft and locks; local vault signs matching network", async (t) => {
  for (const name of ["Pearl mainnet", network]) {
    let record;
    const vault = createVault({ network: name, storage: { async getVault() { return record; }, async setVault(value) { record = value; } },
      locks: { request(_name, _options, work) { return work(); } } });
    t.after(() => vault.lock());
    await vault.init(); await vault.save("hex", keys.seedHex, "public-local-network-password");
    if (name === network) assert.equal(vault.signTransaction(draft).txid, signed.txid);
    else assert.throws(() => vault.signTransaction(draft), /txNetworkSessionMismatch/);
    assert.equal(vault.status.unlocked, false);
  }
});
