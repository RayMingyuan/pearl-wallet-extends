import assert from "node:assert/strict";
import test from "node:test";
import { prlPerKvBToGrainPerVb } from "../src/blockbook-fees.js";
import { deriveAddress, secretToSeed } from "../src/keys.js";

test("estimatefee coin per kvB rounds up to integer grain per vB", () => {
  assert.equal(prlPerKvBToGrainPerVb("0.00001000"), 1);
  assert.equal(prlPerKvBToGrainPerVb("0.00082725"), 83);
  assert.throws(() => prlPerKvBToGrainPerVb("0"));
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
