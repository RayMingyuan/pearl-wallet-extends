import assert from "node:assert/strict";
import test from "node:test";
import { encodePearlAddress } from "../src/address.js";
import { BlockbookError, fetchWatchAddress } from "../src/blockbook.js";
import { LIVE_ADDRESS, LIVE_PROGRAM_HEX } from "./samples.js";

test("live Blockbook address query is distinct from a rejected address", { timeout: 20000 }, async () => {
  const live = await fetchWatchAddress(LIVE_ADDRESS, { pageSize: 1 });
  assert.equal(typeof live.balance, "bigint");
  assert.equal(live.balance >= 0n, true);
  assert.equal(live.activityError, null);
  assert.equal(live.activity.length <= 1, true);
  if (live.activity.length === 1) {
    assert.match(live.activity[0].txid, /^[0-9a-f]{64}$/);
  }

  const program = Uint8Array.from(Buffer.from(LIVE_PROGRAM_HEX, "hex"));
  const p2mr = encodePearlAddress("prl", 2, program);
  const emptyOrUnused = await fetchWatchAddress(p2mr, { pageSize: 1 });
  assert.equal(typeof emptyOrUnused.balance, "bigint");

  const broken = `${LIVE_ADDRESS.slice(0, -1)}${LIVE_ADDRESS.endsWith("h") ? "q" : "h"}`;
  const error = await fetchWatchAddress(broken, { pageSize: 1 }).catch((caught) => caught);
  assert.equal(error instanceof BlockbookError, true);
  assert.equal(error.balance, undefined);
  assert.notEqual(error.kind, undefined);
});
