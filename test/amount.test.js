import assert from "node:assert/strict";
import test from "node:test";
import {
  formatGrains, formatGrainsCompact, GRAIN_PER_PRL, parseSignedGrain, parseUnsignedGrain,
} from "../src/amount.js";

test("formats grain integers without floating point", () => {
  assert.equal(formatGrains(0n), "0");
  assert.equal(formatGrains(1n), "0.00000001");
  assert.equal(formatGrains(GRAIN_PER_PRL), "1");
  assert.equal(formatGrains(11167883818487n), "111678.83818487");
  const supply = 2_100_000_000n * GRAIN_PER_PRL;
  const oddGrain = supply + 1n;
  assert.equal(oddGrain > BigInt(Number.MAX_SAFE_INTEGER), true);
  assert.equal(formatGrains(supply), "2100000000");
  assert.equal(formatGrains(oddGrain), "2100000000.00000001");
  assert.notEqual(BigInt(Number(oddGrain)), oddGrain);
  assert.equal(formatGrains(-5n), "-0.00000005");
});

test("formats compact grains for list and home displays", () => {
  assert.equal(formatGrainsCompact(199_139_538n), "1.9914");
  assert.equal(formatGrainsCompact(100_860_154n), "1.0086");
  assert.equal(formatGrainsCompact(200_000_000n), "2");
  assert.equal(formatGrainsCompact(1n), "0");
  assert.equal(formatGrainsCompact(5_000n), "0.0001");
});

test("rejects non-integer amount encodings", () => {
  for (const value of [0, 0n, "0.1", "1e8", "-1", "00", "", " 0", null]) {
    assert.throws(() => parseUnsignedGrain(value, "balance"));
  }
  assert.equal(parseUnsignedGrain("0", "balance"), 0n);
  assert.equal(parseSignedGrain("-12", "unconfirmedBalance"), -12n);
  assert.throws(() => parseSignedGrain("-01", "unconfirmedBalance"));
  assert.throws(() => formatGrains(1));
});
