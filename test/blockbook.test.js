import assert from "node:assert/strict";
import test from "node:test";
import { addressLooksUsed } from "../src/account-scan.js";
import { BlockbookError, fetchWatchAddress, parseAddressPayload } from "../src/blockbook.js";
import { packMessage, speak } from "../src/i18n.js";
import { LIVE_ADDRESS, TX_A, tx } from "./samples.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

test("parses an explicit zero balance separately from a transport failure", async () => {
  const zero = await fetchWatchAddress(LIVE_ADDRESS, {
    pageSize: 1,
    fetchImpl: async (url) => {
      assert.match(url, /^https:\/\/blockbook\.pearlresearch\.ai\/api\/v2\/address\//);
      assert.match(url, /details=txslight&pageSize=1$/);
      assert.equal(url.includes("/utxo/"), false);
      return jsonResponse(200, {
        balance: "0",
        unconfirmedBalance: "0",
        txs: 0,
        transactions: [],
      });
    },
  });
  assert.equal(zero.balance, 0n);
  assert.equal(zero.unconfirmedBalance, 0n);
  assert.deepEqual(zero.activity, []);
  assert.equal(zero.activityError, null);
});

test("unused Blockbook addresses without a transactions field stay empty, not corrupt", () => {
  // Live Blockbook omits `transactions` when txs is 0. Gap scans need that to mean unused.
  const parsed = parseAddressPayload({
    balance: "0",
    unconfirmedBalance: "0",
    txs: 0,
  }, LIVE_ADDRESS);
  assert.equal(parsed.balance, 0n);
  assert.equal(parsed.txCount, 0);
  assert.deepEqual(parsed.activity, []);
  assert.equal(parsed.activityError, null);
  assert.equal(addressLooksUsed(parsed), false);
});

test("http, network, and shape failures throw instead of returning zero", async () => {
  await assert.rejects(
    () => fetchWatchAddress(LIVE_ADDRESS, {
      fetchImpl: async () => jsonResponse(400, { error: "Invalid address", balance: "0" }),
    }),
    (error) => error instanceof BlockbookError && error.kind === "rejected" && error.message.includes("没有") === false,
  );
  const rejected = await fetchWatchAddress(LIVE_ADDRESS, {
    fetchImpl: async () => jsonResponse(400, { error: "Invalid address", balance: "0" }),
  }).catch((error) => error);
  assert.equal(rejected instanceof BlockbookError, true);
  assert.equal(rejected.balance, undefined);

  const offline = await fetchWatchAddress(LIVE_ADDRESS, {
    fetchImpl: async () => {
      throw new Error("socket");
    },
  }).catch((error) => error);
  assert.equal(offline.kind, "network");
  assert.equal(offline.balance, undefined);

  const html = await fetchWatchAddress(LIVE_ADDRESS, {
    fetchImpl: async () => jsonResponse(502, "<html>down</html>"),
  }).catch((error) => error);
  assert.equal(html.kind, "parse");

  const shaped = await fetchWatchAddress(LIVE_ADDRESS, {
    fetchImpl: async () => jsonResponse(200, { balance: 0, transactions: [] }),
  }).catch((error) => error);
  assert.equal(shaped.kind, "shape");

  const missing = await fetchWatchAddress(LIVE_ADDRESS, {
    fetchImpl: async () => jsonResponse(500, { error: "nope" }),
  }).catch((error) => error);
  assert.equal(missing.kind, "http");
  assert.match(speak(missing, "en"), /HTTP 500/);
});

test("keeps a readable balance when only the history is unusable", () => {
  const parsed = parseAddressPayload({
    balance: "210000000000000000",
    unconfirmedBalance: "-1",
    txs: 1,
    transactions: [{ txid: "bad" }],
  }, LIVE_ADDRESS);
  assert.equal(parsed.balance, 210000000000000000n);
  assert.equal(parsed.unconfirmedBalance, -1n);
  assert.equal(parsed.activityError, packMessage("err.activity.parseFailed"));
  assert.deepEqual(parsed.activity, []);
});

test("reads net flow from a txslight-shaped transaction", () => {
  const parsed = parseAddressPayload({
    balance: "600",
    unconfirmedBalance: "0",
    txs: 1,
    transactions: [tx({
      txid: TX_A,
      vin: [{ addresses: [LIVE_ADDRESS], value: "1000" }],
      vout: [{ addresses: [LIVE_ADDRESS], value: "1600" }],
      confirmations: 0,
      blockTime: null,
    })],
  }, LIVE_ADDRESS);
  assert.equal(parsed.activity[0].direction, "in");
  assert.equal(parsed.activity[0].amount, 600n);
  assert.equal(parsed.activity[0].confirmations, 0);
  assert.equal(parsed.activity[0].time, null);
});
