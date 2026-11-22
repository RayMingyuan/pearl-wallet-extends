import assert from "node:assert/strict";
import test from "node:test";
import { createSpendGuard } from "../src/spend-guard.js";

test("spend guard pins outpoints and blocks conflicting drafts until released", async () => {
  let stored = [];
  const guard = createSpendGuard({
    storage: {
      async getSpendLocks() { return structuredClone(stored); },
      async setSpendLocks(list) { stored = structuredClone(list); },
    },
  });
  const inputs = [{ txid: "11".repeat(32), vout: 0 }, { txid: "22".repeat(32), vout: 1 }];
  await guard.pin(inputs, { txid: "aa".repeat(32), status: "unknown" });
  await assert.rejects(() => guard.assertAvailable(inputs), /pendingConflict/);
  await guard.releaseTxid("aa".repeat(32));
  await guard.assertAvailable(inputs);
});

test("excludeLocked keeps unpinned utxos for the next send", async () => {
  let stored = [];
  const guard = createSpendGuard({
    storage: {
      async getSpendLocks() { return structuredClone(stored); },
      async setSpendLocks(list) { stored = structuredClone(list); },
    },
  });
  const pinned = { txid: "11".repeat(32), vout: 0 };
  const free = { txid: "22".repeat(32), vout: 1 };
  await guard.pin([pinned], { txid: "aa".repeat(32), status: "broadcast" });
  const spendable = await guard.excludeLocked([pinned, free]);
  assert.deepEqual(spendable, [free]);
  await assert.rejects(() => guard.assertAvailable([pinned]), /pendingConflict/);
  await guard.assertAvailable(spendable);
});
