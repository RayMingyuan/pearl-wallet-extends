import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodePearlAddress } from "../src/address.js";
import { fetchSpendableUtxos } from "../src/blockbook.js";

const request = JSON.parse(readFileSync(new URL("./fixtures/pearl-transactions-v1.5.5.json", import.meta.url))).vectors[0].request;
function response(value, status = 200) { return { ok: status === 200, status, async text() { return typeof value === "string" ? value : JSON.stringify(value); } }; }

test("UTXO retrieval uses GET only and verifies each raw previous transaction", async () => {
  const calls = [];
  const results = await fetchSpendableUtxos(request.sourceAddress, { async fetchImpl(url, options) {
    calls.push(url); assert.equal(options.method, "GET"); assert.equal(options.body, undefined);
    if (url.includes("/utxo/")) return response(request.utxos.map(({ prevTxHex, ...record }) => record));
    const record = request.utxos.find((utxo) => url.endsWith(utxo.txid));
    return response({ txid: record.txid, hex: record.prevTxHex });
  } });
  assert.equal(results.length, 2);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((url) => url.startsWith("https://blockbook.pearlresearch.ai/api/v2/")));
  assert.match(calls[0], /confirmed=true$/);
  assert.equal(results[0].script.startsWith("5120"), true);
});

test("UTXO retrieval checks a testnet address against the selected network", async () => {
  const testnet = encodePearlAddress("tprl", 1, new Uint8Array(32).fill(2));
  await assert.rejects(
    () => fetchSpendableUtxos(testnet, { async fetchImpl() { throw new Error("should not fetch"); } }),
    /taprootOnly|P2MR/,
  );
  let called = false;
  await assert.rejects(() => fetchSpendableUtxos(testnet, {
    network: "Pearl testnet",
    async fetchImpl() {
      called = true;
      return response({}, 503);
    },
  }), /503/);
  assert.equal(called, true);
});

test("UTXO retrieval rejects failed/malformed responses and mismatched previous transactions", async () => {
  for (const value of [{ error: "nope" }, "not json", Array(101).fill(request.utxos[0])]) {
    await assert.rejects(() => fetchSpendableUtxos(request.sourceAddress, { async fetchImpl() { return response(value); } }));
  }
  await assert.rejects(() => fetchSpendableUtxos(request.sourceAddress, { async fetchImpl() { return response({}, 503); } }), /503/);
  await assert.rejects(() => fetchSpendableUtxos(request.sourceAddress, { async fetchImpl(url) {
    if (url.includes("/utxo/")) return response([request.utxos[0]]);
    return response({ txid: request.utxos[0].txid, hex: request.utxos[1].prevTxHex });
  } }), /utxoPrevMismatch/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => fetchSpendableUtxos(request.sourceAddress, { signal: controller.signal,
    async fetchImpl() { return response([request.utxos[0]]); } }), /utxoAborted/);
});

test("UTXO retrieval bounds concurrent previous-transaction requests to four", async () => {
  let active = 0; let maximum = 0;
  const many = Array.from({ length: 9 }, (_, index) => ({ ...request.utxos[0], txid: String(index + 1).padStart(64, "0") }));
  await assert.rejects(() => fetchSpendableUtxos(request.sourceAddress, { async fetchImpl(url) {
    if (url.includes("/utxo/")) return response(many);
    active += 1; maximum = Math.max(active, maximum);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return response({ txid: url.split("/").at(-1), hex: request.utxos[0].prevTxHex });
  } }), /utxoPrevMismatch/);
  assert.equal(maximum, 4);
  assert.equal(active, 0);
});
