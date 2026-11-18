import assert from "node:assert/strict";
import test from "node:test";
import { encodePearlAddress, validatePearlMainnetAddress } from "../src/address.js";
import { speak } from "../src/i18n.js";
import { LIVE_ADDRESS, LIVE_PROGRAM_HEX } from "./samples.js";

const program = Uint8Array.from(Buffer.from(LIVE_PROGRAM_HEX, "hex"));

test("accepts the live mainnet taproot address and its witness program", () => {
  const result = validatePearlMainnetAddress(`  ${LIVE_ADDRESS.toUpperCase()}  `);
  assert.equal(result.ok, true);
  assert.equal(result.address, LIVE_ADDRESS);
  assert.equal(result.witnessVersion, 1);
  assert.deepEqual(result.program, program);
});

test("round-trips taproot and p2mr programs", () => {
  const taproot = encodePearlAddress("prl", 1, program);
  assert.equal(taproot, LIVE_ADDRESS);
  const p2mr = encodePearlAddress("prl", 2, program);
  const decoded = validatePearlMainnetAddress(p2mr);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.witnessVersion, 2);
  assert.equal(decoded.address.startsWith("prl1z"), true);
});

test("rejects other networks, legacy text, mixed case, and bad checksums", () => {
  const bad = [
    "",
    "   ",
    "prl1p",
    "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    "tprl1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    LIVE_ADDRESS.slice(0, -1) + (LIVE_ADDRESS.endsWith("h") ? "q" : "h"),
    LIVE_ADDRESS.slice(0, 8).toUpperCase() + LIVE_ADDRESS.slice(8),
    `${LIVE_ADDRESS.slice(0, 20)} ${LIVE_ADDRESS.slice(20)}`,
  ];
  for (const input of bad) {
    const result = validatePearlMainnetAddress(input);
    assert.equal(result.ok, false, input);
    assert.equal("address" in result, false);
  }
});

test("does not treat a failed check as a usable address", () => {
  const result = validatePearlMainnetAddress("not-a-pearl-address");
  assert.equal(result.ok, false);
  assert.match(speak(result.error, "en"), /address/i);
});
