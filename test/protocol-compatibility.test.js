import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { bech32, bech32m } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { encodePearlAddress, validatePearlMainnetAddress } from "../src/address.js";

// Public test data with no funds. Derivation only checks the protocol and is not wired into the extension runtime.
const fixtures = JSON.parse(readFileSync(new URL("../src/pearl-v1.5.5.json", import.meta.url)));
const versions = { private: 0x04b2430c, public: 0x04b24746 };
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const bytes = (value) => Uint8Array.from(Buffer.from(value, "hex"));

function taprootOutputKey(publicKey) {
  // BIP86 uses the even-Y internal key and the TapTweak of an empty script tree. The child public key must not be encoded as the address directly.
  const xonly = publicKey.slice(1);
  const internal = schnorr.utils.lift_x(BigInt(`0x${hex(xonly)}`));
  const tweak = BigInt(`0x${hex(schnorr.utils.taggedHash("TapTweak", xonly))}`);
  assert.ok(tweak < secp256k1.Point.Fn.ORDER);
  const output = tweak === 0n ? internal : internal.add(secp256k1.Point.BASE.multiply(tweak));
  return output.toBytes().slice(1);
}

test("official v1.5.5 receive/change vectors match BIP86 path, output key and address", () => {
  const root = HDKey.fromMasterSeed(bytes(fixtures.seedHex), versions);
  try {
    for (const vector of fixtures.vectors) {
      const child = root.derive(vector.path);
      try {
        assert.equal(hex(child.publicKey), vector.publicKeyHex, vector.path);
        const program = taprootOutputKey(child.publicKey);
        assert.equal(hex(program), vector.programHex, vector.path);
        assert.notEqual(hex(child.publicKey.slice(1)), vector.programHex);
        assert.equal(bech32m.encode("prl", [1, ...bech32m.toWords(program)]), vector.address);
        assert.equal(encodePearlAddress("prl", 1, program), vector.address);
        const parsed = validatePearlMainnetAddress(vector.address);
        assert.equal(parsed.ok, true);
        assert.equal(parsed.witnessVersion, 1);
        assert.equal(hex(parsed.program), vector.programHex);
      } finally {
        child.wipePrivateData();
      }
    }
  } finally {
    root.wipePrivateData();
  }
});

test("account zpub preserves BIP86 public receive/change derivation", () => {
  const root = HDKey.fromMasterSeed(bytes(fixtures.seedHex), versions);
  const account = root.derive("m/86'/808276'/0'");
  const encoded = account.publicExtendedKey;
  assert.ok(encoded.startsWith("zpub"));
  account.wipePrivateData();
  root.wipePrivateData();
  const publicAccount = HDKey.fromExtendedKey(encoded, versions);
  assert.equal(publicAccount.privateKey, null);
  for (const vector of fixtures.vectors) {
    const [, branch, index] = vector.path.match(/\/(\d+)\/(\d+)$/);
    const child = publicAccount.derive(`m/${branch}/${index}`);
    assert.equal(hex(child.publicKey), vector.publicKeyHex);
    assert.equal(encodePearlAddress("prl", 1, taprootOutputKey(child.publicKey)), vector.address);
  }
  assert.throws(() => publicAccount.derive("m/0'"));
});

test("public BIP39 phrase follows the official empty-passphrase seed contract", () => {
  const vector = fixtures.bip39;
  assert.equal(entropyToMnemonic(bytes(vector.entropyHex), wordlist), vector.mnemonic);
  const seed = mnemonicToSeedSync(vector.mnemonic, vector.passphrase);
  try {
    assert.equal(seed.length, 64);
    assert.equal(hex(seed), vector.seedHex);
    // Raw entropy is not a substitute for the BIP32 seed produced by BIP39 PBKDF2.
    const rawRoot = HDKey.fromMasterSeed(bytes(vector.entropyHex), versions);
    const mnemonicRoot = HDKey.fromMasterSeed(seed, versions);
    try {
      assert.notEqual(rawRoot.publicExtendedKey, mnemonicRoot.publicExtendedKey);
    } finally {
      rawRoot.wipePrivateData();
      mnemonicRoot.wipePrivateData();
    }
  } finally {
    seed.fill(0);
  }
});

test("standard BIP32 differs from the official legacy leading-zero counterexample", () => {
  const vector = fixtures.leadingZero;
  const root = HDKey.fromMasterSeed(bytes(vector.seedHex), versions);
  const parent = root.derive("m/0'");
  const child = root.derive(vector.path);
  try {
    assert.equal(parent.privateKey[0], 0);
    assert.equal(hex(child.privateKey), vector.standardChildHex);
    // The official wallet uses DeriveNonStandard. This counterexample stops the standard library from being described as fully recovery-compatible.
    assert.notEqual(hex(child.privateKey), vector.legacyChildHex);
  } finally {
    root.wipePrivateData();
    parent.wipePrivateData();
    child.wipePrivateData();
  }
});

test("Taproot/P2MR encodings agree with an independent bech32m implementation", () => {
  const programs = [new Uint8Array(32), new Uint8Array(32).fill(1), Uint8Array.from({ length: 32 }, (_, i) => i)];
  for (const program of programs) {
    for (const version of [1, 2]) {
      const expected = bech32m.encode("prl", [version, ...bech32m.toWords(program)]);
      assert.equal(encodePearlAddress("prl", version, program), expected);
      const result = validatePearlMainnetAddress(expected.toUpperCase());
      assert.equal(result.ok, true);
      assert.equal(result.address, expected);
      assert.equal(result.witnessVersion, version);
      assert.deepEqual(result.program, program);
    }
  }
});

test("valid checksums cannot bypass network, version, length and padding restrictions", () => {
  const program = new Uint8Array(32).fill(1);
  const words = bech32m.toWords(program);
  const invalid = [
    // Legacy-format and wrong-length counterexamples from the official address_test.go.
    "prl1qw508d6qejxtdg4y5r3zarvary0c5xw7k34d768",
    "prl1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qew38es",
    "prl1pqypqxrhwktn",
  ];
  for (const version of [1, 2]) {
    for (const network of ["tprl", "rprl", "bc"]) {
      invalid.push(bech32m.encode(network, [version, ...words]));
    }
    for (const length of [20, 31, 33, 40]) {
      invalid.push(bech32m.encode("prl", [version, ...bech32m.toWords(new Uint8Array(length))]));
    }
    invalid.push(bech32.encode("prl", [version, ...words]));
    const nonzeroPadding = [...words];
    nonzeroPadding[nonzeroPadding.length - 1] |= 1;
    invalid.push(bech32m.encode("prl", [version, ...nonzeroPadding]));
  }
  for (const version of [0, 3, 16]) invalid.push(bech32m.encode("prl", [version, ...words]));
  for (const address of invalid) {
    const result = validatePearlMainnetAddress(address);
    assert.equal(result.ok, false, address);
    assert.equal("address" in result, false);
  }
});
