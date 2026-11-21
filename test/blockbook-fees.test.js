import assert from "node:assert/strict";
import test from "node:test";
import {
  clearFeeMenuCache,
  expireFeeMenuCache,
  FEE_BLOCKS,
  FEE_FALLBACK,
  fetchFeeMenu,
  prlPerKvBToGrainPerVb,
} from "../src/blockbook-fees.js";
import { deriveAddress, secretToSeed } from "../src/keys.js";

test("estimatefee coin per kvB rounds up to integer grain per vB", () => {
  assert.equal(prlPerKvBToGrainPerVb("0.00001000"), 1);
  assert.equal(prlPerKvBToGrainPerVb("0.00082725"), 83);
  assert.equal(prlPerKvBToGrainPerVb(0.00051294), 52);
  assert.throws(() => prlPerKvBToGrainPerVb("0"));
  assert.throws(() => prlPerKvBToGrainPerVb("-1"));
  assert.throws(() => prlPerKvBToGrainPerVb(-1));
});

test("fee tiers match desktop block targets and raised cold presets", () => {
  assert.deepEqual(FEE_BLOCKS, { slow: 25, standard: 10, fast: 1 });
  assert.deepEqual(FEE_FALLBACK, { slow: 1, standard: 10, fast: 100 });
});

test("fetchFeeMenu queries tiers in parallel and caches live menus only", async () => {
  clearFeeMenuCache();
  let inFlight = 0;
  let peak = 0;
  const seen = [];
  const fetchImpl = async (url) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    seen.push(url);
    await new Promise((resolve) => setTimeout(resolve, 15));
    inFlight -= 1;
    const blocks = url.split("/").pop();
    const result = blocks === "1" ? "0.00051294" : blocks === "10" ? "0.00002432" : "0.00001000";
    return { ok: true, async text() { return JSON.stringify({ result }); } };
  };
  const first = await fetchFeeMenu(fetchImpl, "https://fees.test");
  assert.equal(peak, 3);
  assert.deepEqual(seen.map((url) => url.split("/").pop()).sort(), ["1", "10", "25"]);
  assert.equal(first.fallback, false);
  assert.equal(first.menu.fast, 52);
  assert.equal(first.menu.standard, 3);
  assert.equal(first.menu.slow, 1);

  const before = seen.length;
  const second = await fetchFeeMenu(fetchImpl, "https://fees.test");
  assert.equal(seen.length, before);
  assert.equal(second.menu.fast, first.menu.fast);

  clearFeeMenuCache();
  await fetchFeeMenu(fetchImpl, "https://fees.test");
  assert.equal(seen.length, before + 3);
});

test("failed estimatefee uses last live rates and does not poison the cache", async () => {
  clearFeeMenuCache();
  let mode = "live";
  const fetchImpl = async (url) => {
    if (mode === "down") throw new Error("offline");
    const blocks = url.split("/").pop();
    const result = blocks === "1" ? 0.0051294 : "0.00001000";
    return { ok: true, async text() { return JSON.stringify({ result }); } };
  };
  const live = await fetchFeeMenu(fetchImpl, "https://fees.test");
  assert.equal(live.fallback, false);
  assert.equal(live.menu.fast, 513);

  expireFeeMenuCache();
  mode = "down";
  const soft = await fetchFeeMenu(fetchImpl, "https://fees.test");
  assert.equal(soft.fallback, true);
  assert.equal(soft.menu.fast, 513);
  assert.equal(soft.menu.slow, 1);

  // Fallback answers are not cached, so the next call retries the network.
  mode = "live";
  const again = await fetchFeeMenu(fetchImpl, "https://fees.test");
  assert.equal(again.fallback, false);
  assert.equal(again.menu.fast, 513);
});

test("cold fallback uses raised presets when no live menu exists", async () => {
  clearFeeMenuCache();
  const fetchImpl = async () => {
    throw new Error("offline");
  };
  const cold = await fetchFeeMenu(fetchImpl, "https://fees.test");
  assert.equal(cold.fallback, true);
  assert.deepEqual(cold.menu, FEE_FALLBACK);
});

test("official BIP86 account index changes the receive address", () => {
  const seed = secretToSeed({ kind: "hex", value: "11".repeat(32) });
  const first = deriveAddress(seed, 0, 0, "Pearl mainnet", 0);
  const second = deriveAddress(seed, 0, 0, "Pearl mainnet", 1);
  assert.notEqual(first, second);
  assert.ok(first.startsWith("prl1p"));
  assert.ok(second.startsWith("prl1p"));
  seed.fill(0);
});
