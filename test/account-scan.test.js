import assert from "node:assert/strict";
import test from "node:test";
import { addressLooksUsed, scanChain } from "../src/account-scan.js";

test("scanChain returns next unused index after a successful gap scan", async () => {
  const used = new Set([0, 1]);
  const result = await scanChain(async (index) => used.has(index), 3, 0);
  assert.deepEqual(result, { next: 2, scanned: true });
});

test("scanChain keeps previous cursor when a query fails", async () => {
  const result = await scanChain(async (index) => {
    if (index === 1) throw new Error("network");
    return index === 0;
  }, 5, 4);
  assert.deepEqual(result, { next: 4, scanned: false });
});

test("scanChain probes a gap window in parallel", async () => {
  let inFlight = 0;
  let peak = 0;
  const result = await scanChain(async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight -= 1;
    return false;
  }, 8, 0);
  assert.equal(result.scanned, true);
  assert.equal(result.next, 0);
  assert.ok(peak >= 8);
});

test("scanChain keeps a finished gap when a later probe in the batch fails", async () => {
  const result = await scanChain(async (index) => {
    if (index >= 2) throw new Error("tail");
    return false;
  }, 2, 0);
  assert.deepEqual(result, { next: 0, scanned: true });
});

test("scanChain stops when the address query is aborted", async () => {
  const error = new DOMException("查询已取消", "AbortError");
  await assert.rejects(() => scanChain(async (index) => {
    if (index === 1) throw error;
    return false;
  }, 3, 4), (caught) => caught.name === "AbortError");
});

test("addressLooksUsed treats txCount and balance as activity", () => {
  assert.equal(addressLooksUsed({ txCount: 2, activity: [] }), true);
  assert.equal(addressLooksUsed({ balance: 1n, activity: [] }), true);
  assert.equal(addressLooksUsed({ balance: 0n, activity: [], txCount: 0 }), false);
  assert.equal(addressLooksUsed({ activity: [{ txid: "a" }] }), true);
});
