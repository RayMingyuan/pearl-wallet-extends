import { err } from "./i18n.js";
function concat(parts) {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value) {
  if (typeof value !== "string" || !/^(?:[0-9a-fA-F]{2})+$/.test(value)) throw err("err.psbt.hexInvalid");
  return Uint8Array.from(value.match(/../g), (pair) => parseInt(pair, 16));
}

function compact(value) {
  if (value < 253) return Uint8Array.of(value);
  if (value <= 65535) return Uint8Array.of(253, value & 255, value >> 8);
  throw err("err.psbt.fieldTooLong");
}

function le64(value) {
  const bytes = new Uint8Array(8);
  let n = BigInt(value);
  if (n < 0n || n > 0xffffffffffffffffn) throw err("err.psbt.amountInvalid");
  for (let i = 0; i < 8; i += 1) {
    bytes[i] = Number(n & 255n);
    n >>= 8n;
  }
  return bytes;
}

function pushKv(parts, key, value) {
  parts.push(compact(key.length), key, compact(value.length), value);
}

export function encodePsbt(draft) {
  if (!draft?.unsignedHex || !Array.isArray(draft.inputs) || !Array.isArray(draft.outputs)) {
    throw err("err.psbt.draftInvalid");
  }
  const parts = [Uint8Array.of(0x70, 0x73, 0x62, 0x74, 0xff)];
  pushKv(parts, Uint8Array.of(0x00), fromHex(draft.unsignedHex));
  parts.push(Uint8Array.of(0));
  for (const input of draft.inputs) {
    const script = fromHex(input.script);
    const witness = concat([le64(input.value), compact(script.length), script]);
    pushKv(parts, Uint8Array.of(0x01), witness);
    parts.push(Uint8Array.of(0));
  }
  for (let i = 0; i < draft.outputs.length; i += 1) parts.push(Uint8Array.of(0));
  return hex(concat(parts));
}

function reader(bytes) {
  let offset = 0;
  const take = (size) => {
    if (offset + size > bytes.length) throw err("err.psbt.truncated");
    const slice = bytes.slice(offset, offset + size);
    offset += size;
    return slice;
  };
  const compactInt = () => {
    const first = take(1)[0];
    if (first < 253) return first;
    if (first === 253) {
      const data = take(2);
      return data[0] + (data[1] << 8);
    }
    throw err("err.psbt.lengthInvalid");
  };
  return {
    take,
    compactInt,
    finished: () => offset === bytes.length,
  };
}

function readMap(io) {
  const pairs = [];
  while (true) {
    const keyLength = io.compactInt();
    if (keyLength === 0) return pairs;
    const key = io.take(keyLength);
    const value = io.take(io.compactInt());
    pairs.push({ key, value });
  }
}

export function decodePsbt(text) {
  const bytes = fromHex(text);
  if (bytes.length < 5 || bytes[0] !== 0x70 || bytes[1] !== 0x73 || bytes[2] !== 0x62 || bytes[3] !== 0x74 || bytes[4] !== 0xff) {
    throw err("err.psbt.magicInvalid");
  }
  const io = reader(bytes.slice(5));
  const global = readMap(io);
  const unsigned = global.find((pair) => pair.key.length === 1 && pair.key[0] === 0x00);
  if (!unsigned) throw err("err.psbt.missingUnsignedTx");
  const inputs = [];
  while (!io.finished()) {
    const pairs = readMap(io);
    if (!pairs.length && inputs.length) break;
    const witness = pairs.find((pair) => pair.key.length === 1 && pair.key[0] === 0x01);
    if (!witness) {
      if (!pairs.length) break;
      throw err("err.psbt.missingWitnessUtxo");
    }
    const view = reader(witness.value);
    const amount = view.take(8);
    let n = 0n;
    for (let i = 7; i >= 0; i -= 1) n = (n << 8n) + BigInt(amount[i]);
    const script = view.take(view.compactInt());
    if (!view.finished()) throw err("err.psbt.witnessUtxoExtra");
    inputs.push({ value: n.toString(), script: hex(script) });
    if (io.finished()) break;
  }
  if (!inputs.length) throw err("err.psbt.noInputs");
  return { unsignedHex: hex(unsigned.value), inputs };
}

export function assertPsbtMatches(draft) {
  const parsed = decodePsbt(draft.psbt);
  if (parsed.unsignedHex !== draft.unsignedHex || parsed.inputs.length !== draft.inputs.length) {
    throw err("err.psbt.draftMismatch");
  }
  parsed.inputs.forEach((input, index) => {
    const expected = draft.inputs[index];
    if (input.value !== expected.value || input.script !== expected.script) {
      throw err("err.psbt.draftMismatch");
    }
  });
}
