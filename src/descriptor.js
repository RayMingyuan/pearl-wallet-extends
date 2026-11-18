import { err } from "./i18n.js";
// BIP 380 descriptor checksum. The charset and polymod constants are from
// https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki
const INPUT_CHARSET = "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const CHECKSUM_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn];

function polymod(symbols) {
  let chk = 1n;
  for (const value of symbols) {
    const top = chk >> 35n;
    chk = ((chk & 0x7ffffffffn) << 5n) ^ BigInt(value);
    for (let i = 0; i < 5; i += 1) {
      if ((top >> BigInt(i)) & 1n) chk ^= GEN[i];
    }
  }
  return chk;
}

function expand(text) {
  const groups = [];
  const symbols = [];
  for (const char of text) {
    const value = INPUT_CHARSET.indexOf(char);
    if (value < 0) throw err("err.descriptor.unencodable");
    symbols.push(value & 31);
    groups.push(value >> 5);
    if (groups.length === 3) {
      symbols.push(groups[0] * 9 + groups[1] * 3 + groups[2]);
      groups.length = 0;
    }
  }
  if (groups.length === 1) symbols.push(groups[0]);
  else if (groups.length === 2) symbols.push(groups[0] * 3 + groups[1]);
  return symbols;
}

export function descriptorChecksum(body) {
  const symbols = expand(body);
  for (let i = 0; i < 8; i += 1) symbols.push(0);
  const checksum = polymod(symbols) ^ 1n;
  let text = "";
  for (let i = 0; i < 8; i += 1) {
    text += CHECKSUM_CHARSET[Number((checksum >> BigInt(5 * (7 - i))) & 31n)];
  }
  return text;
}

export function withChecksum(body) {
  return `${body}#${descriptorChecksum(body)}`;
}

export const GAP_LIMIT = 20;

export function trDescriptor({ fingerprint, coinType, account, xpub, change }) {
  const body = `tr([${fingerprint}/86h/${coinType}h/${account}h]${xpub}/${change}/*)`;
  return withChecksum(body);
}
