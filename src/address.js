import { err } from "./i18n.js";
/**
 * Pearl mainnet public-address check.
 *
 * Official constraints used here, from pearl tag v1.5.5 (the pearld version
 * Blockbook reported) and the public help center:
 * - Mainnet bech32 HRP is "prl" (chaincfg.MainNetParams.Bech32HRPSegwit).
 * - DecodeAddress accepts only bech32m witness version 1 (Taproot) and
 *   version 2 (P2MR), each with a 32-byte program (node/btcutil/address.go).
 * - The help center states that a public address begins with prl1p. That is
 *   the witness-version-1 spelling. Version 2 is also accepted because the
 *   node and the live Blockbook both accept it.
 * The default mainnet validator rejects testnet and local addresses.
 * The explicit local-chain validator accepts rprl only for regtest/simnet.
 */

import { packMessage } from "./i18n.js";
import { getNetwork } from "./networks.js";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32M_CONST = 0x2bc830a3;
const PROGRAM_LENGTH = 32;

function polymod(values) {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) ^ value) >>> 0;
    for (let i = 0; i < 5; i += 1) {
      if ((top >>> i) & 1) chk = (chk ^ GENERATOR[i]) >>> 0;
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i += 1) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const out = [];
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of data) {
    if (!Number.isInteger(value) || value < 0 || value >> fromBits !== 0) {
      return null;
    }
    acc = ((acc << fromBits) | value) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    return null;
  }
  return out;
}

function decodeBech32m(address) {
  if (typeof address !== "string" || address.length < 8 || address.length > 90) {
    return { error: packMessage("err.addr.invalidBech32m") };
  }
  const hasLower = address !== address.toUpperCase();
  const hasUpper = address !== address.toLowerCase();
  if (hasLower && hasUpper) {
    return { error: packMessage("err.addr.mixedCase") };
  }
  const lower = address.toLowerCase();
  const sep = lower.lastIndexOf("1");
  if (sep < 1 || sep + 7 > lower.length) {
    return { error: packMessage("err.addr.invalidBech32m") };
  }
  const hrp = lower.slice(0, sep);
  const data = [];
  for (const char of lower.slice(sep + 1)) {
    const value = CHARSET.indexOf(char);
    if (value === -1) {
      return { error: packMessage("err.addr.badChars") };
    }
    data.push(value);
  }
  const checksum = polymod(hrpExpand(hrp).concat(data));
  if (checksum !== BECH32M_CONST) {
    return { error: packMessage("err.addr.checksum") };
  }
  return { hrp, words: data.slice(0, -6) };
}

export function encodePearlAddress(hrp, witnessVersion, program) {
  if (!Number.isInteger(witnessVersion) || witnessVersion < 1 || witnessVersion > 16) {
    throw err("err.addr.witnessVersionUnsupported");
  }
  if (!(program instanceof Uint8Array) || program.length < 2 || program.length > 40) {
    throw err("err.addr.witnessProgramLength");
  }
  const grouped = convertBits(program, 8, 5, true);
  if (!grouped) throw err("err.addr.witnessProgramEncode");
  const words = [witnessVersion, ...grouped];
  const combined = words.concat([0, 0, 0, 0, 0, 0]);
  const mod = polymod(hrpExpand(hrp.toLowerCase()).concat(combined)) ^ BECH32M_CONST;
  for (let i = 0; i < 6; i += 1) {
    words.push((mod >>> (5 * (5 - i))) & 31);
  }
  return `${hrp.toLowerCase()}1${words.map((word) => CHARSET[word]).join("")}`;
}

export function validatePearlMainnetAddress(input) {
  return validatePearlAddress(input, "Pearl mainnet");
}

export function validatePearlAddress(input, network) {
  const { hrp } = getNetwork(network);
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (!trimmed) return { ok: false, error: packMessage("err.addr.enterFirst") };
  const decoded = decodeBech32m(trimmed);
  if (decoded.error) return { ok: false, error: decoded.error };
  if (decoded.hrp !== hrp) {
    return { ok: false, error: packMessage("err.addr.hrpMismatch", { hrp }) };
  }
  if (decoded.words.length < 1) {
    return { ok: false, error: packMessage("err.addr.missingWitnessVersion") };
  }
  const witnessVersion = decoded.words[0];
  if (witnessVersion !== 1 && witnessVersion !== 2) {
    return { ok: false, error: packMessage("err.addr.witnessVersionRejected") };
  }
  const bytes = convertBits(decoded.words.slice(1), 5, 8, false);
  if (!bytes || bytes.length !== PROGRAM_LENGTH) {
    return { ok: false, error: packMessage("err.addr.programNot32Bytes") };
  }
  const program = Uint8Array.from(bytes);
  const canonical = encodePearlAddress(hrp, witnessVersion, program);
  if (canonical !== trimmed.toLowerCase()) {
    return { ok: false, error: packMessage("err.addr.checksum") };
  }
  return {
    ok: true,
    address: canonical,
    witnessVersion,
    program,
  };
}
