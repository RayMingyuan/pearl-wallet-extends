import { err } from "./i18n.js";
import { HDKey, HARDENED_OFFSET } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { encodePearlAddress } from "./address.js";
import { trDescriptor } from "./descriptor.js";
import { getNetwork } from "./networks.js";

const versions = { private: 0x04b2430c, public: 0x04b24746 };
const field = secp256k1.Point.Fn;
const hex = (bytes) => Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

export function generateMnemonic(crypto = globalThis.crypto, { words = 12 } = {}) {
  const count = words === 24 ? 24 : 12;
  const entropy = crypto.getRandomValues(new Uint8Array(count === 24 ? 32 : 16));
  try { return entropyToMnemonic(entropy, wordlist); }
  finally { entropy.fill(0); }
}

export function normalizeSecret(kind, value) {
  if (typeof value !== "string" || value.length > 1024) throw err("err.keys.seedFormatInvalid");
  if (kind === "mnemonic") {
    const normalized = value.normalize("NFKD").trim().toLowerCase().split(/\s+/).join(" ");
    if (!validateMnemonic(normalized, wordlist)) throw err("err.keys.mnemonicInvalid");
    return { kind, value: normalized };
  }
  if (kind === "hex") {
    const normalized = value.trim().toLowerCase();
    if (!/^(?:[0-9a-f]{2}){16,64}$/.test(normalized)) throw err("err.keys.hexSeedInvalid");
    return { kind, value: normalized };
  }
  throw err("err.keys.seedUnsupported");
}

export function secretToSeed(secret) {
  const normalized = normalizeSecret(secret.kind, secret.value);
  if (normalized.kind === "mnemonic") return mnemonicToSeedSync(normalized.value, "");
  return Uint8Array.from(normalized.value.match(/../g), (pair) => parseInt(pair, 16));
}

// Matches only the official v1.5.5 DeriveNonStandard encoding. Scalars and curve math stay in a maintained library.
export function deriveLegacyChild(parent, index) {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) throw err("err.keys.deriveIndexInvalid");
  const privateKey = parent.privateKey;
  const chainCode = parent.chainCode;
  const data = new Uint8Array(37);
  let digest;
  let childKey;
  try {
    if (!privateKey || !chainCode) throw err("err.keys.needLocalDerivation");
    if (index >= HARDENED_OFFSET) {
      // NewMaster keeps all 32 bytes. Later nodes use big.Int.Bytes, which drops leading zeros, then the bytes are copied left-aligned.
      let offset = 0;
      if (parent.depth > 0) while (offset < 31 && privateKey[offset] === 0) offset += 1;
      data.set(privateKey.subarray(offset), 1);
    } else {
      data.set(parent.publicKey);
    }
    new DataView(data.buffer).setUint32(33, index, false);
    digest = hmac(sha512, chainCode, data);
    const tweak = field.fromBytes(digest.subarray(0, 32), true);
    // The official wallet rejects an invalid child key. Do not let the standard library silently advance to another index.
    if (!field.isValidNot0(tweak)) throw err("err.keys.childKeyInvalid");
    const scalar = field.create(field.fromBytes(privateKey) + tweak);
    if (!field.isValidNot0(scalar)) throw err("err.keys.childKeyInvalid");
    childKey = field.toBytes(scalar);
    return new HDKey({
      versions, privateKey: childKey, chainCode: digest.subarray(32),
      depth: parent.depth + 1, index, parentFingerprint: parent.fingerprint,
    });
  } finally {
    privateKey?.fill(0);
    chainCode?.fill(0);
    data.fill(0);
    digest?.fill(0);
    childKey?.fill(0);
  }
}

function accountIndex(account) {
  const value = account ?? 0;
  if (!Number.isInteger(value) || value < 0 || value >= HARDENED_OFFSET) throw err("err.keys.accountIndexInvalid");
  return value;
}

function deriveNode(seed, branch, index, network, account = 0) {
  const { coinType } = getNetwork(network);
  if (![0, 1].includes(branch) || !Number.isInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
    throw err("err.keys.pathBranchInvalid");
  }
  let node = HDKey.fromMasterSeed(seed, versions);
  try {
    for (const childIndex of [86 + HARDENED_OFFSET, coinType + HARDENED_OFFSET, accountIndex(account) + HARDENED_OFFSET, branch, index]) {
      const child = deriveLegacyChild(node, childIndex);
      node.wipePrivateData();
      node = child;
    }
    return node;
  } catch (error) { node.wipePrivateData(); throw error; }
}

export function deriveAddress(seed, branch = 0, index = 0, network = "Pearl mainnet", account = 0) {
  const node = deriveNode(seed, branch, index, network, account);
  try {
    const xonly = node.publicKey.slice(1);
    const internal = schnorr.utils.lift_x(BigInt(`0x${hex(xonly)}`));
    const tweak = BigInt(`0x${hex(schnorr.utils.taggedHash("TapTweak", xonly))}`);
    if (!field.isValid(tweak)) throw err("err.keys.taprootOutputInvalid");
    const output = tweak === 0n ? internal : internal.add(secp256k1.Point.BASE.multiply(tweak));
    if (output.equals(secp256k1.Point.ZERO)) throw err("err.keys.taprootOutputInvalid");
    return encodePearlAddress(getNetwork(network).hrp, 1, output.toBytes().slice(1));
  } finally {
    node.wipePrivateData();
  }
}

export function describeAccount(seed, account = 0, network = "Pearl mainnet") {
  const { coinType } = getNetwork(network);
  const acc = accountIndex(account);
  let node = HDKey.fromMasterSeed(seed, versions);
  const fingerprint = [...node.pubKeyHash.subarray(0, 4)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  try {
    for (const childIndex of [86 + HARDENED_OFFSET, coinType + HARDENED_OFFSET, acc + HARDENED_OFFSET]) {
      const child = deriveLegacyChild(node, childIndex);
      node.wipePrivateData();
      node = child;
    }
    const xpub = node.publicExtendedKey;
    return {
      fingerprint,
      xpub,
      receiveDescriptor: trDescriptor({ fingerprint, coinType, account: acc, xpub, change: 0 }),
      changeDescriptor: trDescriptor({ fingerprint, coinType, account: acc, xpub, change: 1 }),
    };
  } finally {
    node.wipePrivateData();
  }
}

function outputKeyFromPrivate(privateKey) {
  const point = secp256k1.Point.fromBytes(secp256k1.getPublicKey(privateKey, true));
  const xonly = point.toBytes(true).slice(1);
  const internal = schnorr.utils.lift_x(BigInt(`0x${hex(xonly)}`));
  const tweak = BigInt(`0x${hex(schnorr.utils.taggedHash("TapTweak", xonly))}`);
  if (!field.isValid(tweak)) throw err("err.keys.taprootOutputInvalid");
  const output = tweak === 0n ? internal : internal.add(secp256k1.Point.BASE.multiply(tweak));
  if (output.equals(secp256k1.Point.ZERO)) throw err("err.keys.taprootOutputInvalid");
  return output.toBytes().slice(1);
}

export function normalizePrivateKey(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase().replace(/^0x/, "") : "";
  if (!/^[0-9a-f]{64}$/.test(text)) throw err("err.keys.privateKeyHexInvalid");
  const bytes = Uint8Array.from(text.match(/../g), (pair) => parseInt(pair, 16));
  if (!field.isValidNot0(field.fromBytes(bytes))) throw err("err.keys.privateKeyScalarInvalid");
  return bytes;
}

export function addressFromPrivateKey(privateKey, network = "Pearl mainnet") {
  const bytes = privateKey instanceof Uint8Array ? privateKey : normalizePrivateKey(privateKey);
  try { return encodePearlAddress(getNetwork(network).hrp, 1, outputKeyFromPrivate(bytes)); }
  finally { if (!(privateKey instanceof Uint8Array)) bytes.fill(0); }
}

export function signTaprootHashes(seed, branch, index, hashes, crypto = globalThis.crypto, network = "Pearl mainnet", account = 0) {
  const node = deriveNode(seed, branch, index, network, account);
  const privateKey = node.privateKey;
  let tweaked;
  try {
    const publicKey = node.publicKey;
    const tweak = BigInt(`0x${hex(schnorr.utils.taggedHash("TapTweak", publicKey.slice(1)))}`);
    if (!field.isValid(tweak)) throw err("err.keys.taprootTweakInvalid");
    const scalar = field.fromBytes(privateKey);
    // The x-only internal key uses the even-Y point: flip the private-key sign first, then add the TapTweak for an empty script tree.
    const evenScalar = publicKey[0] === 3 ? field.neg(scalar) : scalar;
    const outputScalar = field.create(evenScalar + tweak);
    if (!field.isValidNot0(outputScalar)) throw err("err.keys.taprootPrivateInvalid");
    tweaked = field.toBytes(outputScalar);
    return hashes.map((hash) => {
      // Each signature draws auxiliary randomness from WebCrypto. The untweaked private key is never exported.
      const auxiliary = crypto.getRandomValues(new Uint8Array(32));
      try { return schnorr.sign(hash, tweaked, auxiliary); }
      finally { auxiliary.fill(0); }
    });
  } finally {
    tweaked?.fill(0); privateKey?.fill(0); node.wipePrivateData();
  }
}
