import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLatestSpendHint,
  filterActivity,
  formatBlockTime,
  interpretTransaction,
  interpretTransactions,
  mergeActivityGroups,
} from "../src/activity.js";
import { packMessage } from "../src/i18n.js";
import { LIVE_ADDRESS, TX_A, TX_B, tx } from "./samples.js";

test("classifies net flow in grains, including fee in the outflow", () => {
  const incoming = interpretTransaction(tx({
    vout: [{ addresses: [LIVE_ADDRESS], value: "250" }],
  }), LIVE_ADDRESS);
  assert.equal(incoming.direction, "in");
  assert.equal(incoming.amount, 250n);

  const outgoing = interpretTransaction(tx({
    vin: [{ addresses: [LIVE_ADDRESS], value: "1000", isOwn: true }],
    vout: [
      { addresses: [LIVE_ADDRESS], value: "400", isOwn: true },
      { addresses: ["prl1pother"], value: "500" },
    ],
  }), LIVE_ADDRESS);
  assert.equal(outgoing.direction, "out");
  assert.equal(outgoing.amount, 600n);

  const self = interpretTransaction(tx({
    vin: [{ isOwn: true, value: "100" }],
    vout: [{ isOwn: true, value: "100" }],
  }), LIVE_ADDRESS);
  assert.equal(self.direction, "self");
  assert.equal(self.amount, 0n);
});

test("prefers explicit addresses over a conflicting isOwn flag", () => {
  const item = interpretTransaction(tx({
    vout: [{ addresses: ["prl1psomeoneelse"], value: "9", isOwn: true }],
  }), LIVE_ADDRESS);
  assert.equal(item.direction, "self");
  assert.equal(item.amount, 0n);
});

test("malformed history becomes an error and does not invent rows", () => {
  const parsed = interpretTransactions([{ txid: "nope" }], LIVE_ADDRESS);
  assert.deepEqual(parsed.activity, []);
  assert.equal(parsed.activityError, packMessage("err.activity.parseFailed"));
  const missing = interpretTransactions(undefined, LIVE_ADDRESS);
  assert.equal(missing.activityError, packMessage("err.activity.dataMissing"));
});

test("filters income and spend without dropping the source list", () => {
  const rows = [
    { direction: "in", amount: 1n, txid: TX_A },
    { direction: "out", amount: 2n, txid: TX_B },
    { direction: "self", amount: 0n, txid: TX_A },
  ];
  assert.equal(filterActivity(rows, "in").length, 1);
  assert.equal(filterActivity(rows, "out").length, 1);
  assert.equal(filterActivity(rows, "all").length, 3);
});

test("formats absolute Shanghai time", () => {
  assert.equal(formatBlockTime(0, "zh"), "1970/01/01 08:00");
  assert.match(formatBlockTime(0, "en"), /1970/);
});

test("local latest-send hint overrides outgoing display amount without changing direction", () => {
  const rows = [
    { txid: TX_A, direction: "out", amount: 500000000n, confirmations: 0, time: null },
    { txid: TX_B, direction: "in", amount: 500000000n, confirmations: 25, time: 1 },
  ];
  const hinted = applyLatestSpendHint(rows, { txid: TX_A.toUpperCase(), payment: "100860000", fee: "424" });
  assert.equal(hinted[0].direction, "out");
  assert.equal(hinted[0].amount, 100860000n);
  assert.equal(hinted[1].amount, 500000000n);
  assert.equal(rows[0].amount, 500000000n, "源数组保持不变");
});

test("wallet activity merges source and change rows by txid", () => {
  const txid = TX_A;
  const merged = mergeActivityGroups([
    [{ txid, direction: "out", amount: 500000000n, confirmations: 6, time: 10 }],
    [{ txid, direction: "in", amount: 399139846n, confirmations: 6, time: 10 }],
    [{ txid: TX_B, direction: "in", amount: 500000000n, confirmations: 32, time: 9 }],
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], {
    txid,
    direction: "out",
    amount: 100860154n,
    confirmations: 6,
    time: 10,
  });
  assert.deepEqual(merged[1], {
    txid: TX_B,
    direction: "in",
    amount: 500000000n,
    confirmations: 32,
    time: 9,
  });
});
