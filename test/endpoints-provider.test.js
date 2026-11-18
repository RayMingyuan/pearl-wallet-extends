import assert from "node:assert/strict";
import test from "node:test";
import { createEndpoints } from "../src/endpoints.js";
import { createProvider } from "../src/provider.js";
import { handleVaultMessage } from "../src/background.js";
import { createVaultSession, dispatchVault } from "../src/vault-host.js";

test("reads fail over and broadcast hits only the selected indexer", async () => {
  const calls = [];
  const endpoints = createEndpoints([
    "https://first.example",
    "https://second.example",
  ]);
  const value = await endpoints.read(async (origin) => {
    calls.push(origin);
    if (origin.endsWith("first.example")) throw new Error("down");
    return "ok";
  });
  assert.equal(value, "ok");
  assert.deepEqual(calls, ["https://first.example", "https://second.example"]);
  calls.length = 0;
  await endpoints.broadcast(async (origin) => { calls.push(origin); });
  assert.deepEqual(calls, ["https://first.example"]);
  endpoints.select(1);
  calls.length = 0;
  await endpoints.broadcast(async (origin) => { calls.push(origin); });
  assert.deepEqual(calls, ["https://second.example"]);
});

test("an aborted read does not continue to the next indexer", async () => {
  const endpoints = createEndpoints(["https://first.example", "https://second.example"]);
  const calls = [];
  await assert.rejects(() => endpoints.read(async (origin) => {
    calls.push(origin);
    throw new DOMException("查询已取消", "AbortError");
  }), (error) => error.name === "AbortError");
  assert.deepEqual(calls, ["https://first.example"]);
});

test("provider stays closed unless explicitly enabled and never broadcasts by default", async () => {
  const closed = createProvider();
  await assert.rejects(() => closed.request("requestAccounts", {}, { userGesture: true }), /err\.provider\.disabled/);
  let on = false;
  const open = createProvider({
    enabled: async () => on,
    accounts: async () => ["prl1example"],
  });
  on = true;
  await assert.rejects(() => open.request("requestAccounts"), /err\.provider\.needUserGesture/);
  assert.deepEqual(await open.request("requestAccounts", {}, { userGesture: true }), ["prl1example"]);
  await assert.rejects(() => open.request("signPsbt", { psbt: "70736274ff00", broadcast: true }, { userGesture: true }), /err\.provider\.noBroadcast/);
  const signed = await open.request("signPsbt", { psbt: "70736274ff00" }, { userGesture: true });
  assert.equal(signed.broadcast, false);
});

test("background session stores only an unlock deadline and directory responses omit secrets", async () => {
  const fixture = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/pearl-v1.5.5.json", import.meta.url), "utf8")));
  const session = createVaultSession();
  let vaultRecord = null;
  let sessionValue = null;
  const send = (message) => handleVaultMessage(message, {
    readVault: async () => vaultRecord,
    writeVault: async (record) => { vaultRecord = record; },
    removeVault: async () => { vaultRecord = null; },
    writeSession: async (value) => { sessionValue = value; },
    clearSession: async () => { sessionValue = null; },
    ensureOffscreen: async () => {},
    dispatch: (message) => dispatchVault(session, message),
  });
  const saved = await send({ target: "vault", op: "save", kind: "hex", value: fixture.seedHex, password: "public-test-password-123" });
  assert.equal(saved.ok, true);
  assert.equal(saved.status.unlocked, true);
  assert.equal(typeof sessionValue.pearlUnlockedUntil, "number");
  assert.equal(JSON.stringify(sessionValue).includes(fixture.seedHex), false);
  assert.equal(JSON.stringify(vaultRecord).includes(fixture.seedHex), false);
  const directory = await send({ target: "vault", op: "directory" });
  assert.equal(directory.ok, true);
  assert.equal(JSON.stringify(directory).includes(fixture.seedHex), false);
  assert.equal(directory.result.accounts[0].address, fixture.vectors[0].address);
  const mnemonicDenied = await send({ target: "vault", op: "mnemonic" });
  assert.equal(mnemonicDenied.ok, false);
  const mnemonicAllowed = await send({ target: "vault", op: "mnemonic", password: "public-test-password-123" });
  assert.equal(mnemonicAllowed.ok, true);
  const removeDenied = await send({ target: "vault", op: "remove" });
  assert.equal(removeDenied.ok, false);
  assert.ok(vaultRecord);
  const signDenied = await send({ target: "vault", op: "signTransaction", draft: {} });
  assert.equal(signDenied.ok, false);
  assert.equal((await send({ target: "vault", op: "directory" })).status.unlocked, true);
  const locked = await send({ target: "vault", op: "lock" });
  assert.equal(locked.status.unlocked, false);
  assert.equal(sessionValue, null);
});
