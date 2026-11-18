import { readFileSync } from "node:fs";
import { deriveAddress, signTaprootHashes } from "../src/keys.js";
import { buildDraft, decodeTransaction, finalizeTransaction, fromHex, signatureHashes, taprootScript } from "../src/transaction.js";

const seed = fromHex(JSON.parse(readFileSync(new URL("../src/pearl-v1.5.5.json", import.meta.url))).seedHex);
const network = "Pearl simnet";
const sourceAddress = deriveAddress(seed, 0, 0, network);
const value = Buffer.alloc(8); value.writeBigUInt64LE(200000000n);
const raw = `0200000001${"11".repeat(32)}0000000000ffffffff01${value.toString("hex")}22${taprootScript(sourceAddress, network)}00000000`;
export const simnetDraft = buildDraft({ network, sourceAddress, sourcePath: { branch: 0, index: 0 },
  destination: deriveAddress(seed, 0, 1, network), changeAddress: deriveAddress(seed, 1, 0, network), changeIndex: 0,
  amount: "1", feeRate: 2, maxFee: "0.01",
  utxos: [{ txid: decodeTransaction(raw).txid, vout: 0, value: "200000000", confirmations: 10, prevTxHex: raw }] });
export const simnetSigned = finalizeTransaction(simnetDraft,
  signTaprootHashes(seed, 0, 0, signatureHashes(simnetDraft), globalThis.crypto, network));
export const simnetSession = "aa".repeat(16);
export const simnetPairing = "bb".repeat(32);
export function memorySimnetArea() {
  const mem = {};
  return { mem, async get(key) { return structuredClone({ [key]: mem[key] }); },
    async set(value) { Object.assign(mem, structuredClone(value)); } };
}
export function serialSimnetLocks() {
  const queues = new Map();
  return { request(key, _options, work) {
    const result = (queues.get(key) || Promise.resolve()).then(work);
    queues.set(key, result.catch(() => {}));
    return result;
  } };
}
