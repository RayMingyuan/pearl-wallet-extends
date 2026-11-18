import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HDKey, HARDENED_OFFSET } from "@scure/bip32";
import { deriveAddress, deriveLegacyChild, generateMnemonic, normalizeSecret, secretToSeed } from "../src/keys.js";

const fixture = JSON.parse(readFileSync(new URL("../src/pearl-v1.5.5.json", import.meta.url)));
const bytes = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));

test("production legacy derivation matches all ten official Pearl receive/change addresses", () => {
  for (const vector of fixture.vectors) {
    const [, branch, index] = vector.path.match(/\/(\d+)\/(\d+)$/);
    assert.equal(deriveAddress(bytes(fixture.seedHex), Number(branch), Number(index)), vector.address);
  }
});

test("production compatibility adapter executes official legacy leading-zero counterexample", () => {
  const root = HDKey.fromMasterSeed(bytes(fixture.leadingZero.seedHex));
  const parent = deriveLegacyChild(root, HARDENED_OFFSET);
  const child = deriveLegacyChild(parent, HARDENED_OFFSET);
  try {
    assert.equal(parent.privateKey[0], 0);
    assert.equal(Buffer.from(child.privateKey).toString("hex"), fixture.leadingZero.legacyChildHex);
    assert.notEqual(Buffer.from(child.privateKey).toString("hex"), fixture.leadingZero.standardChildHex);
  } finally {
    root.wipePrivateData(); parent.wipePrivateData(); child.wipePrivateData();
  }
});

test("mnemonic generation uses supplied WebCrypto entropy and import validates formats", () => {
  let requests = 0;
  const phrase = generateMnemonic({ getRandomValues(buffer) { requests += 1; buffer.fill(0); return buffer; } });
  assert.equal(requests, 1);
  assert.equal(phrase, fixture.bip39.mnemonic);
  assert.equal(phrase.split(" ").length, 12);
  const long = generateMnemonic({ getRandomValues(buffer) { buffer.fill(1); return buffer; } }, { words: 24 });
  assert.equal(long.split(" ").length, 24);
  assert.equal(normalizeSecret("mnemonic", long).value.split(" ").length, 24);
  assert.deepEqual(normalizeSecret("mnemonic", `  ${phrase.toUpperCase().replaceAll(" ", "\n")} `), { kind: "mnemonic", value: phrase });
  assert.equal(Buffer.from(secretToSeed({ kind: "mnemonic", value: phrase })).toString("hex"), fixture.bip39.seedHex);
  assert.deepEqual(secretToSeed({ kind: "hex", value: fixture.seedHex }), bytes(fixture.seedHex));
  for (const [kind, value] of [["mnemonic", "abandon ".repeat(12)], ["hex", "00"], ["hex", "gg".repeat(16)], ["xprv", "xprv"]]) {
    assert.throws(() => normalizeSecret(kind, value));
  }
  assert.throws(() => deriveAddress(bytes(fixture.seedHex), 2));
  assert.throws(() => deriveAddress(bytes(fixture.seedHex), 0, HARDENED_OFFSET));
});
