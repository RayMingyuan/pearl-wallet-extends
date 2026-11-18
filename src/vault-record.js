import { err } from "./i18n.js";
export const VAULT_KEY = "pearlVault";
export const ITERATIONS = 600000;

export const encode = (bytes) => btoa(String.fromCharCode(...bytes));

export function decode(text, length) {
  if (typeof text !== "string" || text.length > 4096) throw err("err.vault.ciphertextFormatInvalid");
  let bytes;
  try { bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0)); }
  catch { throw err("err.vault.ciphertextFormatInvalid"); }
  if (encode(bytes) !== text || (length && bytes.length !== length)) throw err("err.vault.ciphertextFormatInvalid");
  return bytes;
}

export function validateVaultRecord(record) {
  if (!record || Object.keys(record).sort().join() !== "ciphertext,iterations,iv,kdf,salt,version"
    || record.version !== 2 || record.kdf !== "PBKDF2-SHA256" || record.iterations !== ITERATIONS) {
    throw err("err.vault.unsupportedOrCorrupt");
  }
  const salt = decode(record.salt, 16);
  const iv = decode(record.iv, 12);
  const ciphertext = decode(record.ciphertext);
  if (ciphertext.length < 17 || ciphertext.length > 16384) throw err("err.vault.ciphertextFormatInvalid");
  return { salt, iv, ciphertext };
}
