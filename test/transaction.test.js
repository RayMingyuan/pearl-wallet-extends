import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createVault } from "../src/vault.js";
import { buildDraft, decodeTransaction, DUST_GRAIN, estimateVsize, finalizeTransaction, fromHex, hex,
  parsePrlAmount, signatureHashes, taprootScript, validateDraft, verifyUtxos } from "../src/transaction.js";
import { signTaprootHashes, deriveAddress } from "../src/keys.js";
import { encodePearlAddress } from "../src/address.js";
import { speak } from "../src/i18n.js";

function errLike(pattern) {
  return (error) => {
    assert.match(speak(error, "en"), pattern);
    return true;
  };
}

const keys = JSON.parse(readFileSync(new URL("../src/pearl-v1.5.5.json", import.meta.url)));
const official = JSON.parse(readFileSync(new URL("./fixtures/pearl-transactions-v1.5.5.json", import.meta.url)));
const request = official.vectors[0].request;
const seed = fromHex(keys.seedHex);
const zeroAux = { getRandomValues(buffer) { buffer.fill(0); return buffer; } };

// A public synthetic previous transaction, used only for coin-selection boundaries. It is not an on-chain UTXO.
export function syntheticUtxo(value, { coinbase = false, confirmations = 120, nonce = 1, address = request.sourceAddress } = {}) {
  const amount = Buffer.alloc(8); amount.writeBigUInt64LE(BigInt(value));
  const outpoint = coinbase ? "00".repeat(32) + "ffffffff" : nonce.toString(16).padStart(2, "0").repeat(32) + "00000000";
  const raw = `0200000001${outpoint}00ffffffff01${amount.toString("hex")}22${taprootScript(address)}00000000`;
  return { txid: decodeTransaction(raw).txid, vout: 0, value: String(value), confirmations, prevTxHex: raw };
}

test("official Go vectors match DEFAULT sighashes, signatures, raw transactions, txids and vsize", () => {
  assert.equal(official.sourceCommit, keys.sourceCommit);
  assert.equal(official.vectors.length, 4);
  assert.equal(BigInt(official.dustThreshold), DUST_GRAIN);
  for (const vector of official.vectors) {
    const draft = buildDraft(vector.request);
    assert.equal(draft.unsignedHex, vector.unsignedHex);
    const hashes = signatureHashes(draft);
    assert.deepEqual(hashes.map(hex), vector.hashes);
    const signatures = signTaprootHashes(seed, vector.request.sourcePath.branch, vector.request.sourcePath.index, hashes, zeroAux);
    assert.deepEqual(signatures.map(hex), vector.signatures);
    const signed = finalizeTransaction(draft, signatures);
    assert.deepEqual(signed, { rawHex: vector.rawHex, txid: vector.txid, vsize: vector.vsize, fee: vector.fee });
    assert.equal(decodeTransaction(signed.rawHex).txid, vector.txid);
  }
});

test("amount parsing preserves all eight decimals and rejects floats, negatives and excess supply", () => {
  assert.equal(parsePrlAmount("21000000000"), 2100000000000000000n);
  assert.equal(parsePrlAmount("0.00000001"), 1n);
  assert.equal(parsePrlAmount("90071992.54740993"), 9007199254740993n);
  for (const value of [0.1, "1e-8", "-1", "01", "1.000000001", ".1", "1.", "21000000000.00000001", " 1"]) assert.throws(() => parsePrlAmount(value));
});

test("selection computes exact change, drops uneconomic change into fee, and honors the fee cap", () => {
  const changed = buildDraft(request);
  assert.equal(changed.change, "69576");
  assert.equal(BigInt(changed.total), BigInt(changed.payment) + BigInt(changed.change) + BigInt(changed.fee));
  const simple = { ...request, amount: "0.001", feeRate: 1, utxos: [syntheticUtxo(100200)] };
  const dust = buildDraft(simple);
  assert.equal(dust.outputs.length, 1);
  assert.equal(dust.change, "0");
  assert.equal(dust.fee, "200");
  const exact = buildDraft({ ...simple, utxos: [syntheticUtxo(100154 + 333)] });
  assert.equal(exact.change, "333");
  assert.equal(exact.fee, "154");
  assert.throws(() => buildDraft({ ...simple, maxFee: "0.00000199" }), errLike(/maximum total fee/i));
  assert.throws(() => buildDraft({ ...simple, utxos: [syntheticUtxo(100000)] }), errLike(/Insufficient/));
  assert.throws(() => buildDraft({ ...simple, amount: "0.00000332" }), errLike(/dust/));
});

test("MAX deducts fees, unconfirmed and immature coinbase cannot be selected", () => {
  const utxos = [syntheticUtxo(200000, { nonce: 1 }), syntheticUtxo(120000, { nonce: 2 }),
    syntheticUtxo(900000, { nonce: 3, confirmations: 0 }), syntheticUtxo(800000, { coinbase: true, confirmations: 99 })];
  const draft = buildDraft({ ...request, utxos, amount: "MAX" });
  assert.equal(draft.inputs.length, 2);
  assert.equal(draft.payment, "319662");
  assert.equal(draft.fee, "338");
  assert.equal(draft.change, "0");
  const mature = buildDraft({ ...request, amount: "MAX", utxos: [syntheticUtxo(800000, { coinbase: true, confirmations: 100 })] });
  assert.equal(mature.inputs.length, 1);
  assert.throws(() => buildDraft({ ...request, utxos: [utxos[2], utxos[3]] }), errLike(/confirmed.*UTXO/i));
});

test("UTXO validation rejects duplicate outpoints, forged amounts/scripts/txids and malformed raw data", () => {
  const input = request.utxos[0];
  assert.throws(() => verifyUtxos([input, input], request.sourceAddress), errLike(/Duplicate/));
  for (const patch of [{ value: "1" }, { txid: "11".repeat(32) }, { vout: 99 }, { confirmations: -1 }, { prevTxHex: input.prevTxHex + "00" }]) {
    assert.throws(() => verifyUtxos([{ ...input, ...patch }], request.sourceAddress));
  }
  assert.throws(() => verifyUtxos([input], request.destination), errLike(/does not match/));
  for (const raw of ["00", "0", "gg", input.prevTxHex.slice(0, -2)]) assert.throws(() => decodeTransaction(raw));
  assert.throws(() => verifyUtxos(Array(101).fill(input), request.sourceAddress), errLike(/100/));
});

test("P2MR, wrong networks, invalid fees, paths and changed drafts fail closed", () => {
  const p2mr = encodePearlAddress("prl", 2, new Uint8Array(32).fill(1));
  for (const field of ["sourceAddress", "destination", "changeAddress"]) {
    assert.throws(() => buildDraft({ ...request, [field]: p2mr }), errLike(/P2MR/));
  }
  for (const feeRate of [0, -1, 1.5, 10001, "2"]) assert.throws(() => buildDraft({ ...request, feeRate }));
  assert.throws(() => buildDraft({ ...request, destination: request.sourceAddress }), errLike(/spending|same as change/i));
  assert.throws(() => buildDraft({ ...request, changeIndex: -1 }), errLike(/path|Derivation/i));
  const draft = buildDraft(request);
  assert.equal(Object.isFrozen(draft.inputs[0]), true);
  assert.deepEqual(validateDraft(draft), draft);
  assert.throws(() => validateDraft({ ...draft, fee: "1" }), errLike(/changed/i));
  assert.throws(() => finalizeTransaction(draft, draft.inputs.map(() => new Uint8Array(64))), errLike(/signature verification/i));
  assert.equal(estimateVsize(100, 2), 5847);
});

test("vault signs only a revalidated draft for its source/change paths and locks afterward", async (t) => {
  let record;
  const vault = createVault({ storage: { async getVault() { return record; }, async setVault(value) { record = value; } },
    locks: { request(_name, _options, work) { return work(); } } });
  t.after(() => vault.lock());
  await vault.init();
  await vault.save("hex", keys.seedHex, "public-transaction-test-password");
  const draft = buildDraft(request);
  const signed = vault.signTransaction(draft);
  assert.equal(signed.txid, official.vectors[0].txid);
  assert.equal(vault.status.unlocked, false);
  assert.throws(() => vault.signTransaction(draft), errLike(/Unlock/));
  await vault.unlock("public-transaction-test-password");
  const wrongPath = buildDraft({ ...request, sourcePath: { branch: 0, index: 1 } });
  assert.throws(() => vault.signTransaction(wrongPath), errLike(/vault path|not on/i));
  assert.equal(vault.status.unlocked, false);
});

test("finalize checks each input against its own taproot script", () => {
  const receive0 = deriveAddress(seed, 0, 0);
  const receive1 = deriveAddress(seed, 0, 1);
  const destination = deriveAddress(seed, 0, 2);
  const change = deriveAddress(seed, 1, 3);
  for (const address of [receive0, receive1, change]) assert.notEqual(destination, address);
  const utxos = [
    { ...syntheticUtxo(200000, { nonce: 1, address: receive0 }), address: receive0, path: { branch: 0, index: 0, account: 0 } },
    { ...syntheticUtxo(200000, { nonce: 2, address: receive1 }), address: receive1, path: { branch: 0, index: 1, account: 0 } },
  ];
  const draft = buildDraft({
    utxos,
    sourceAddress: receive0,
    sourcePath: { branch: 0, index: 0, account: 0 },
    destination,
    changeAddress: change,
    changeIndex: 3,
    amount: "MAX",
    feeRate: 1,
    maxFee: "0.1",
  });
  assert.equal(draft.inputs.length, 2);
  assert.notEqual(draft.inputs[0].script, draft.inputs[1].script);
  const hashes = signatureHashes(draft);
  const signatures = draft.inputs.map((input, index) => signTaprootHashes(
    seed, input.path.branch, input.path.index, [hashes[index]], zeroAux, "Pearl mainnet", input.path.account,
  )[0]);
  const signed = finalizeTransaction(draft, signatures);
  assert.equal(decodeTransaction(signed.rawHex).txid, signed.txid);
  assert.throws(() => finalizeTransaction(draft, [signatures[1], signatures[0]]), errLike(/signature verification/i));
});
