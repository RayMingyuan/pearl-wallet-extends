import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createVaultSession, dispatchVault } from "../src/vault-host.js";
import { buildDraft } from "../src/transaction.js";

const keys = JSON.parse(readFileSync(new URL("../src/pearl-v1.5.5.json", import.meta.url)));
const official = JSON.parse(readFileSync(new URL("./fixtures/pearl-transactions-v1.5.5.json", import.meta.url)));
const PASSWORD = "public-send-auth-test-password";
const request = official.vectors[0].request;

function testTimers() {
  const timers = new Set();
  return {
    schedule(fn) {
      const id = { fn };
      timers.add(id);
      return id;
    },
    cancel(id) { timers.delete(id); },
    clear() { timers.clear(); },
  };
}

test("send-auth grace keeps the session unlocked for a follow-up sign without retyping", async () => {
  let clock = 1_000_000;
  const timers = testTimers();
  const session = createVaultSession({
    idleMs: 5 * 60_000,
    network: "Pearl mainnet",
    now: () => clock,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  await dispatchVault(session, { op: "init", record: null });
  await dispatchVault(session, {
    op: "save",
    kind: "hex",
    value: keys.seedHex,
    password: PASSWORD,
  });
  const draft = buildDraft(request);

  const first = await dispatchVault(session, {
    op: "signTransaction",
    draft,
    password: PASSWORD,
    rememberMins: 15,
  });
  assert.equal(first.ok, true);
  assert.equal(first.status.unlocked, true);
  assert.equal(first.result.txid, official.vectors[0].txid);

  const status = await dispatchVault(session, { op: "sendAuthStatus" });
  assert.equal(status.ok, true);
  assert.equal(status.result.active, true);

  const second = await dispatchVault(session, {
    op: "signTransaction",
    draft,
    password: "",
  });
  assert.equal(second.ok, true);
  assert.equal(second.result.txid, official.vectors[0].txid);

  clock += 16 * 60_000;
  const expired = await dispatchVault(session, { op: "sendAuthStatus" });
  assert.equal(expired.result.active, false);
  const denied = await dispatchVault(session, {
    op: "signTransaction",
    draft,
    password: "",
  });
  assert.equal(denied.ok, false);
  await dispatchVault(session, { op: "lock" });
  timers.clear();
});

test("send-auth survives vault lock and still signs after unlock window", async () => {
  let clock = 2_000_000;
  const timers = testTimers();
  const session = createVaultSession({
    idleMs: 5 * 60_000,
    network: "Pearl mainnet",
    now: () => clock,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  await dispatchVault(session, { op: "init", record: null });
  await dispatchVault(session, {
    op: "save",
    kind: "hex",
    value: keys.seedHex,
    password: PASSWORD,
  });
  const draft = buildDraft(request);
  const first = await dispatchVault(session, {
    op: "signTransaction",
    draft,
    password: PASSWORD,
    rememberMins: 15,
  });
  assert.equal(first.ok, true);

  // Auto-lock / manual lock drops the UI session and the mnemonic plaintext.
  // The binary seed stays for the grace window, so signing does not need the password.
  await dispatchVault(session, { op: "lock" });
  assert.equal(session.vault.status.unlocked, false);
  const status = await dispatchVault(session, { op: "sendAuthStatus" });
  assert.equal(status.result.active, true);
  const words = await dispatchVault(session, { op: "mnemonic", password: PASSWORD });
  assert.equal(words.ok, false);

  // Within the 15-minute window, signing still works without retyping.
  clock += 6 * 60_000;
  const second = await dispatchVault(session, {
    op: "signTransaction",
    draft,
    password: "",
  });
  assert.equal(second.ok, true);
  assert.equal(second.result.txid, official.vectors[0].txid);
  await dispatchVault(session, { op: "lock" });
  timers.clear();
});
