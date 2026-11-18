import { err } from "./i18n.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { schnorr } from "@noble/curves/secp256k1.js";
import { validatePearlAddress } from "./address.js";
import { getNetwork } from "./networks.js";
import { assertPsbtMatches, encodePsbt } from "./psbt.js";

export const MAX_GRAIN = 2_100_000_000_000_000_000n;
export const DUST_GRAIN = 333n;
export const MAX_INPUTS = 100;
export const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
export function fromHex(value) {
  if (typeof value !== "string" || value.length > 800000 || !/^(?:[0-9a-fA-F]{2})+$/.test(value)) throw err("err.tx.hexInvalid");
  return Uint8Array.from(value.match(/../g), (pair) => parseInt(pair, 16));
}
const concat = (...parts) => {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
};
function le(value, size) {
  const bytes = new Uint8Array(size);
  let n = BigInt(value);
  if (n < 0n || n >= 1n << BigInt(size * 8)) throw err("err.tx.integerOutOfRange");
  for (let i = 0; i < size; i += 1) { bytes[i] = Number(n & 255n); n >>= 8n; }
  return bytes;
}
function compact(value) {
  if (value < 253) return le(value, 1);
  if (value <= 65535) return concat(Uint8Array.of(253), le(value, 2));
  return concat(Uint8Array.of(254), le(value, 4));
}
const variable = (bytes) => concat(compact(bytes.length), bytes);
const txid = (bytes) => hex(sha256(sha256(bytes)).reverse());
const outpoint = (input) => concat(fromHex(input.txid).reverse(), le(input.vout, 4));
const outputBytes = (output) => concat(le(BigInt(output.value), 8), variable(fromHex(output.script)));

export function parsePrlAmount(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,10})(?:\.\d{1,8})?$/.test(value)) throw err("err.tx.amountFormat");
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
  if (amount > MAX_GRAIN) throw err("err.tx.amountTooLarge");
  return amount;
}

export function taprootScript(address, network = "Pearl mainnet") {
  const parsed = validatePearlAddress(address, network);
  if (!parsed.ok || parsed.witnessVersion !== 1) throw err("err.tx.taprootOnly");
  return `5120${hex(parsed.program)}`;
}

// Parse the previous transaction and rebuild the non-witness encoding to check the txid. Do not trust the JSON summary for amounts, scripts, or coinbase.
export function decodeTransaction(rawHex) {
  const bytes = fromHex(rawHex);
  let offset = 0;
  const take = (size) => {
    if (offset + size > bytes.length) throw err("err.tx.prevTxTruncated");
    const result = bytes.slice(offset, offset + size); offset += size; return result;
  };
  const number = (size) => {
    let n = 0n; const data = take(size);
    for (let i = size - 1; i >= 0; i -= 1) n = (n << 8n) + BigInt(data[i]);
    return n;
  };
  const count = () => {
    const prefix = Number(number(1));
    const n = prefix < 253 ? BigInt(prefix) : number(prefix === 253 ? 2 : prefix === 254 ? 4 : 8);
    if (n > 400000n || (prefix === 253 && n < 253n) || (prefix === 254 && n <= 65535n) || (prefix === 255 && n <= 0xffffffffn)) {
      throw err("err.tx.prevTxLengthInvalid");
    }
    return Number(n);
  };
  const version = take(4);
  let witness = false;
  if (bytes[offset] === 0) {
    take(1);
    if (Number(number(1)) !== 1) throw err("err.tx.witnessMarkerUnsupported");
    witness = true;
  }
  const inputCount = count();
  if (inputCount < 1 || inputCount > 10000) throw err("err.tx.prevInputCountInvalid");
  const inputs = [];
  for (let i = 0; i < inputCount; i += 1) {
    const hash = take(32); const index = take(4); const script = take(count()); const sequence = take(4);
    inputs.push({ bytes: concat(hash, index, variable(script), sequence), coinbase: hash.every((n) => n === 0) && index.every((n) => n === 255) });
  }
  const outputCount = count();
  if (outputCount < 1 || outputCount > 10000) throw err("err.tx.prevOutputCountInvalid");
  const outputs = [];
  let total = 0n;
  for (let i = 0; i < outputCount; i += 1) {
    const value = number(8); const script = hex(take(count()));
    total += value;
    if (value > MAX_GRAIN || total > MAX_GRAIN) throw err("err.tx.prevOutputValueInvalid");
    outputs.push({ value: value.toString(), script });
  }
  const witnesses = [];
  if (witness) {
    let hasWitness = false;
    for (let i = 0; i < inputCount; i += 1) {
      const items = count();
      if (items > 10000) throw err("err.tx.witnessItemsTooMany");
      hasWitness ||= items > 0;
      const stack = [];
      for (let j = 0; j < items; j += 1) stack.push(hex(take(count())));
      witnesses.push(stack);
    }
    if (!hasWitness) throw err("err.tx.emptyWitnessInvalid");
  }
  const locktime = take(4);
  if (offset !== bytes.length) throw err("err.tx.prevTxTrailingData");
  const stripped = concat(version, compact(inputCount), ...inputs.map((input) => input.bytes), compact(outputCount), ...outputs.map(outputBytes), locktime);
  return { txid: txid(stripped), outputs, coinbase: inputCount === 1 && inputs[0].coinbase, witnesses };
}

export function verifyUtxos(records, sourceAddress, network = "Pearl mainnet") {
  if (!Array.isArray(records) || records.length > MAX_INPUTS) throw err("err.tx.utxoListInvalid");
  const seen = new Set();
  let rawSize = 0;
  return records.map((record) => {
    if (!record || !/^[0-9a-f]{64}$/.test(record.txid) || !Number.isInteger(record.vout) || record.vout < 0 || record.vout > 0xffffffff
      || typeof record.value !== "string" || !/^[1-9]\d{0,18}$/.test(record.value)
      || !Number.isSafeInteger(record.confirmations) || record.confirmations < 0) throw err("err.tx.utxoFieldInvalid");
    const address = record.address || sourceAddress;
    if (typeof address !== "string" || !address) throw err("err.tx.utxoMissingAddress");
    const script = taprootScript(address, network);
    const key = `${record.txid}:${record.vout}`;
    if (seen.has(key)) throw err("err.tx.utxoDuplicate");
    seen.add(key);
    rawSize += typeof record.prevTxHex === "string" ? record.prevTxHex.length : 0;
    if (rawSize > 8000000) throw err("err.tx.prevTxDataCap");
    const previous = decodeTransaction(record.prevTxHex);
    const output = previous.outputs[record.vout];
    if (previous.txid !== record.txid || !output || output.value !== record.value || output.script !== script) throw err("err.tx.utxoPrevMismatch");
    const entry = {
      txid: record.txid, vout: record.vout, value: record.value, script, address,
      confirmations: record.confirmations, coinbase: previous.coinbase, prevTxHex: record.prevTxHex,
    };
    if (record.path) entry.path = path(record.path);
    return Object.freeze(entry);
  });
}

function serialize(inputs, outputs, signatures) {
  return concat(le(2, 4), ...(signatures ? [Uint8Array.of(0, 1)] : []), compact(inputs.length),
    ...inputs.map((input) => concat(outpoint(input), Uint8Array.of(0), le(0xffffffff, 4))), compact(outputs.length),
    ...outputs.map(outputBytes), ...(signatures ? signatures.map((signature) => concat(Uint8Array.of(1), variable(signature))) : []), le(0, 4));
}
export function estimateVsize(inputs, outputs) {
  const base = 4 + compact(inputs).length + inputs * 41 + compact(outputs).length + outputs * 43 + 4;
  return Math.ceil((base * 4 + 2 + inputs * 66) / 4);
}
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function path(value) {
  if (!value || ![0, 1].includes(value.branch) || !Number.isInteger(value.index) || value.index < 0 || value.index >= 0x80000000) throw err("err.tx.pathInvalid");
  const account = value.account == null ? 0 : value.account;
  if (!Number.isInteger(account) || account < 0 || account >= 0x80000000) throw err("err.keys.accountIndexInvalid");
  return { branch: value.branch, index: value.index, account };
}

export function buildDraft({ utxos, sourceAddress, sourcePath, destination, changeAddress, changeIndex, amount, feeRate, maxFee, network = "Pearl mainnet" }) {
  getNetwork(network);
  const destinationScript = taprootScript(destination, network);
  const changeScript = taprootScript(changeAddress, network);
  const originPath = path(sourcePath);
  const changePath = path({ branch: 1, index: changeIndex, account: originPath.account });
  if (destinationScript === changeScript) throw err("err.tx.destSameAsChange");
  if (!Number.isInteger(feeRate) || feeRate < 1 || feeRate > 10000) throw err("err.tx.feeRateRange");
  const cap = parsePrlAmount(maxFee);
  if (cap === 0n) throw err("err.tx.feeCapZero");
  const max = amount === "MAX";
  let payment = max ? 0n : parsePrlAmount(amount);
  if (!max && payment < DUST_GRAIN) throw err("err.tx.belowDust");
  const verified = verifyUtxos(utxos, sourceAddress, network).map((utxo) => {
    const inputPath = utxo.path || originPath;
    const address = utxo.address || sourceAddress;
    if (utxo.script === destinationScript) {
      throw err("err.tx.selfPayment");
    }
    if (utxo.script === changeScript) {
      throw err("err.tx.changeStillFunded");
    }
    return Object.freeze({ ...utxo, address, path: inputPath });
  });
  const available = verified.filter((utxo) => utxo.confirmations >= (utxo.coinbase ? 100 : 1))
    .sort((a, b) => BigInt(a.value) === BigInt(b.value) ? `${a.txid}:${a.vout}`.localeCompare(`${b.txid}:${b.vout}`) : BigInt(a.value) > BigInt(b.value) ? -1 : 1);
  if (!available.length) throw err("err.tx.noMatureUtxo");
  const selected = []; let total = 0n; let change = 0n; let fee = 0n;
  for (const input of available) {
    selected.push(input); total += BigInt(input.value);
    if (total > MAX_GRAIN) throw err("err.tx.inputTotalOverflow");
    if (max) continue;
    const withChangeFee = BigInt(estimateVsize(selected.length, 2)) * BigInt(feeRate);
    if (total >= payment + withChangeFee + DUST_GRAIN) { change = total - payment - withChangeFee; fee = withChangeFee; break; }
    const minimum = BigInt(estimateVsize(selected.length, 1)) * BigInt(feeRate);
    if (total >= payment + minimum) { fee = total - payment; break; }
  }
  if (max) { fee = BigInt(estimateVsize(selected.length, 1)) * BigInt(feeRate); payment = total - fee; }
  if (payment < DUST_GRAIN || total < payment + fee || fee === 0n) throw err("err.tx.insufficientFunds");
  if (fee > cap) throw err("err.tx.feeAboveCap");
  const outputs = [{ address: destination, value: payment.toString(), script: destinationScript }];
  if (change > 0n) outputs.push({ address: changeAddress, value: change.toString(), script: changeScript });
  const vsize = estimateVsize(selected.length, outputs.length);
  const primary = selected[0];
  const displaySource = sourceAddress || primary.address;
  const draft = {
    network,
    sourceAddress: displaySource,
    sourcePath: primary.path,
    changeAddress,
    changeIndex: changePath.index,
    changePath,
    destination,
    amount,
    feeRate,
    maxFee,
    utxos: verified,
    inputs: selected,
    outputs,
    payment: payment.toString(),
    change: change.toString(),
    fee: fee.toString(),
    total: total.toString(),
    vsize,
    unsignedHex: hex(serialize(selected, outputs)),
    sourceScript: primary.script,
  };
  draft.psbt = encodePsbt(draft);
  return freeze(draft);
}

// DEFAULT sighash only, no annex and no script path. Each hash commits to every input amount and script, and to every output.
export function signatureHashes(draft) {
  const hashes = [
    sha256(concat(...draft.inputs.map(outpoint))),
    sha256(concat(...draft.inputs.map((input) => le(BigInt(input.value), 8)))),
    sha256(concat(...draft.inputs.map((input) => variable(fromHex(input.script))))),
    sha256(concat(...draft.inputs.map(() => le(0xffffffff, 4)))),
    sha256(concat(...draft.outputs.map(outputBytes))),
  ];
  return draft.inputs.map((_, index) => schnorr.utils.taggedHash("TapSighash",
    concat(Uint8Array.of(0, 0), le(2, 4), le(0, 4), ...hashes, Uint8Array.of(0), le(index, 4))));
}

export function finalizeTransaction(draft, signatures) {
  if (!Array.isArray(signatures) || signatures.length !== draft.inputs.length) throw err("err.tx.signatureCount");
  if (typeof draft.psbt === "string") assertPsbtMatches(draft);
  for (const input of draft.inputs) {
    if (!input.address || taprootScript(input.address, draft.network) !== input.script) {
      throw err("err.tx.psbtScriptMismatch");
    }
  }
  const hashes = signatureHashes(draft);
  signatures.forEach((signature, index) => {
    const script = draft.inputs[index]?.script;
    if (typeof script !== "string" || !script.startsWith("5120")) throw err("err.tx.localSigVerifyFailed");
    const outputKey = fromHex(script).slice(2);
    if (signature.length !== 64 || outputKey.length !== 32 || !schnorr.verify(signature, hashes[index], outputKey)) {
      throw err("err.tx.localSigVerifyFailed");
    }
  });
  const raw = serialize(draft.inputs, draft.outputs, signatures);
  const stripped = serialize(draft.inputs, draft.outputs);
  const vsize = Math.ceil((stripped.length * 3 + raw.length) / 4);
  if (vsize !== draft.vsize || BigInt(draft.fee) < BigInt(draft.feeRate) * BigInt(vsize)) throw err("err.tx.vsizeFeeCheckFailed");
  return Object.freeze({ rawHex: hex(raw), txid: txid(stripped), vsize, fee: draft.fee });
}

export function validateDraft(draft) {
  const rebuilt = buildDraft(draft);
  if (JSON.stringify(rebuilt) !== JSON.stringify(draft)) throw err("err.tx.draftStale");
  return rebuilt;
}

export function verifySignedTransaction(draft, signed) {
  const checked = validateDraft(draft);
  const decoded = decodeTransaction(signed.rawHex);
  if (decoded.witnesses.length !== checked.inputs.length || decoded.witnesses.some((stack) => stack.length !== 1)) {
    throw err("err.tx.sigTypeUnsupported");
  }
  const rebuilt = finalizeTransaction(checked, decoded.witnesses.map(([signature]) => fromHex(signature)));
  if (["rawHex", "txid", "vsize", "fee"].some((field) => rebuilt[field] !== signed[field])) {
    throw err("err.tx.signedDraftMismatch");
  }
  return rebuilt;
}
