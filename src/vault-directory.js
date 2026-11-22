import { err } from "./i18n.js";
import { deriveAddress, describeAccount, secretToSeed } from "./keys.js";
import { GAP_LIMIT } from "./descriptor.js";

export const META_KEY = "pearlVaultMeta";
export const V2_AAD_TEXT = "Pearl Pocket vault v2";

export const IDLE_MIN_LIMIT = Object.freeze({ min: 1, max: 120 });
const IDLE_PRESETS = Object.freeze(new Set([1, 5, 15]));

export function idleMinutes(value) {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(n) || n < IDLE_MIN_LIMIT.min || n > IDLE_MIN_LIMIT.max) return 5;
  return n;
}

export function isIdlePreset(minutes) {
  return IDLE_PRESETS.has(minutes);
}

export function buildDirectory({ secret, book, network = "Pearl mainnet" }) {
  const seed = secretToSeed(secret);
  try {
    const derived = (book?.items || []).filter((item) => item.kind === "derived");
    const accounts = [];
    const accountIds = [];
    if (derived.length) {
      for (const item of derived) {
        const accountIndex = Number.isInteger(item.account) ? item.account : 0;
        const described = describeAccount(seed, accountIndex, network);
        const expected = deriveAddress(seed, 0, 0, network, accountIndex);
        const id = item.id || `d${accountIndex}`;
        accountIds.push(id);
        accounts.push({
          id,
          name: item.name || `账户 ${accountIndex + 1}`,
          keyringId: "hd0",
          networkId: network,
          account: accountIndex,
          purpose: 86,
          coinType: 808276,
          receiveDescriptor: described.receiveDescriptor,
          changeDescriptor: described.changeDescriptor,
          receiveNext: Number.isInteger(item.receiveIndex) ? item.receiveIndex : 0,
          changeNext: Number.isInteger(item.changeIndex) ? item.changeIndex : 0,
          gapLimit: item.gapLimit || GAP_LIMIT,
          // For display, the account address stays at 0/0. The rotated receive index is stored separately as receiveNext.
          address: expected,
        });
      }
    } else {
      const described = describeAccount(seed, 0, network);
      const address = deriveAddress(seed, 0, 0, network, 0);
      accountIds.push("d0");
      accounts.push({
        id: "d0",
        name: "账户 1",
        keyringId: "hd0",
        networkId: network,
        account: 0,
        purpose: 86,
        coinType: 808276,
        receiveDescriptor: described.receiveDescriptor,
        changeDescriptor: described.changeDescriptor,
        receiveNext: 0,
        changeNext: 0,
        gapLimit: GAP_LIMIT,
        address,
      });
    }
    // Watch-only addresses live in the plaintext account book (prlAccountBook), not the sealed vault.
    // Keep an empty `watch` array for schema compatibility with older ciphertext.
    const imported = (secret.imports || []).filter((item) => item && item.key).map((item) => ({
      id: item.id || `k${item.address || ""}`,
      type: "imported",
      spendable: false,
      secret: { kind: "key", value: item.key },
      address: item.address || "",
    }));
    return {
      directory: {
        schemaVersion: 2,
        keyrings: [
          { id: "hd0", type: "hd", secret: { kind: secret.kind, value: secret.value }, accounts: accountIds },
          ...imported,
        ],
        accounts,
        watch: [],
      },
    };
  } finally { seed.fill(0); }
}

export function projectAccounts(directory) {
  const accounts = (directory?.accounts || []).map((account) => ({
    id: account.id,
    name: account.name || "账户 1",
    kind: "derived",
    account: account.account,
    address: account.address || null,
    receiveIndex: account.receiveNext ?? 0,
    changeIndex: account.changeNext ?? 0,
    receiveDescriptor: account.receiveDescriptor,
    changeDescriptor: account.changeDescriptor,
    gapLimit: account.gapLimit || GAP_LIMIT,
  }));
  const watch = (directory?.watch || []).map((item) => ({
    id: item.id, name: item.name || "观察地址", kind: "watch", address: item.address,
  }));
  const imported = (directory?.keyrings || [])
    .filter((item) => item.type === "imported")
    .map((item) => ({
      id: item.id,
      name: "导入私钥",
      kind: "key",
      address: item.address,
    }));
  return { accounts, watch, imported };
}

export function directoryFromPacked(body) {
  if (!body || body.schemaVersion !== 2 || !Array.isArray(body.keyrings) || !Array.isArray(body.accounts)) {
    throw err("err.vault.directoryInvalid");
  }
  const hd = body.keyrings.find((item) => item.type === "hd" && item.secret);
  if (!hd) throw err("err.vault.missingHdMaterial");
  return { directory: body, hd };
}

export function secretFromDirectory(directory) {
  const { hd } = directoryFromPacked(directory);
  const imports = (directory.keyrings || [])
    .filter((item) => item.type === "imported" && item.secret?.kind === "key")
    .map((item) => ({
      id: item.id,
      address: item.address || "",
      key: item.secret.value,
    }));
  return { kind: hd.secret.kind, value: hd.secret.value, imports };
}
