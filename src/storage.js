import { err } from "./i18n.js";
import { VAULT_KEY, validateVaultRecord } from "./vault-record.js";

export const ADDRESS_KEY = "prlWatchAddress";
export const WALLET_CONTEXT_KEY = "prlWalletContext";
export const LOCAL_WALLETS_KEY = "prlLocalWallets";
export const ACTIVE_LOCAL_WALLET_KEY = "prlActiveLocalWallet";

export function validateWalletContext(value, address) {
  if (value == null) return null; // Older builds stored only an address. Treat it as watch-only and do not infer a private key.
  if (value.kind !== "local" || value.address !== address || ![0, 1].includes(value.branch)
    || !Number.isInteger(value.index) || value.index < 0 || value.index >= 0x80000000) {
    throw err("err.storage.addressMismatch");
  }
  return { kind: "local", address, branch: value.branch, index: value.index };
}

function assertStoredAddress(value) {
  if (typeof value !== "string") {
    throw err("err.storage.notPubkeyString");
  }
  if (value.length === 0 || value.length > 90) {
    throw err("err.storage.recordAbnormal");
  }
  return value;
}

function validWalletId(value) {
  return typeof value === "string" && /^[a-z0-9]{8,32}$/.test(value);
}

function randomWalletId() {
  const bytes = globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint8Array(8))
    : Uint8Array.from(Array.from({ length: 8 }, () => Math.floor(Math.random() * 256)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function walletLabel(wallets) {
  return `本地钱包 ${wallets.length + 1}`;
}

function validateWalletMeta(value) {
  if (!value || typeof value !== "object") throw err("err.storage.walletListCorrupt");
  if (!validWalletId(value.id)) throw err("err.storage.walletListCorrupt");
  if (typeof value.label !== "string" || value.label.length < 1 || value.label.length > 40) {
    throw err("err.storage.walletListCorrupt");
  }
  const address = assertStoredAddress(value.address);
  if (!Number.isInteger(value.branch) || ![0, 1].includes(value.branch)
    || !Number.isInteger(value.index) || value.index < 0 || value.index >= 0x80000000) {
    throw err("err.storage.walletListCorrupt");
  }
  validateVaultRecord(value.vault);
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0
    || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < value.createdAt) {
    throw err("err.storage.walletListCorrupt");
  }
  return Object.freeze({
    id: value.id,
    label: value.label,
    address,
    branch: value.branch,
    index: value.index,
    vault: value.vault,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function validateWallets(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw err("err.storage.walletListCorrupt");
  const ids = new Set();
  return value.map((entry) => {
    const wallet = validateWalletMeta(entry);
    if (ids.has(wallet.id)) throw err("err.storage.walletListCorrupt");
    ids.add(wallet.id);
    return wallet;
  });
}

function contextFromWallet(wallet) {
  return Object.freeze({ kind: "local", address: wallet.address, branch: wallet.branch, index: wallet.index });
}

export function invokeStore(store, method, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve(value);
    };
    const timer = setTimeout(() => finish(err("err.storage.noResponse")), timeoutMs);
    try {
      let fromCallback = false;
      const result = store[method](...args, (value) => {
        fromCallback = true;
        const runtimeError = globalThis.chrome?.runtime?.lastError;
        finish(runtimeError ? new Error(runtimeError.message) : null, value);
      });
      // When both a callback and a Promise are supplied, an empty Promise result must not win and report that an existing vault is missing.
      if (result && typeof result.then === "function") {
        result.then((value) => {
          if (fromCallback) return;
          if (value !== undefined) { finish(null, value); return; }
          setTimeout(() => { if (!fromCallback) finish(null, undefined); }, 0);
        }, (error) => {
          setTimeout(() => { if (!fromCallback) finish(error); }, 0);
        });
      }
    } catch (error) {
      finish(error);
    }
  });
}

export function createChromeStorage(area, { timeoutMs = 4000 } = {}) {
  const store = area ?? globalThis.chrome?.storage?.local;
  if (!store) throw err("err.storage.chromeLocalUnavailable");
  async function readWallets() {
    const got = await invokeStore(store, "get", [LOCAL_WALLETS_KEY], timeoutMs);
    return validateWallets(got?.[LOCAL_WALLETS_KEY]);
  }
  async function readActiveWalletId() {
    const got = await invokeStore(store, "get", [ACTIVE_LOCAL_WALLET_KEY], timeoutMs);
    const value = got?.[ACTIVE_LOCAL_WALLET_KEY];
    if (value == null) return null;
    if (!validWalletId(value)) throw err("err.storage.walletStateCorrupt");
    return value;
  }
  async function readCurrentVault() {
    const got = await invokeStore(store, "get", [VAULT_KEY], timeoutMs);
    const record = got?.[VAULT_KEY] ?? null;
    if (record == null) return null;
    validateVaultRecord(record);
    return record;
  }
  async function writeWalletState(wallets, activeId = null) {
    if (activeId != null && !validWalletId(activeId)) throw err("err.storage.walletStateCorrupt");
    const data = {
      [LOCAL_WALLETS_KEY]: wallets.map((wallet) => ({ ...wallet })),
      [ACTIVE_LOCAL_WALLET_KEY]: activeId,
    };
    await invokeStore(store, "set", [data], timeoutMs);
  }
  async function syncActiveWallet(context) {
    const checked = validateWalletContext(context, context.address);
    if (!checked) return null;
    const vault = await readCurrentVault();
    if (!vault) return null;
    const wallets = await readWallets();
    const activeId = await readActiveWalletId();
    const now = Date.now();
    let id = activeId;
    const index = activeId ? wallets.findIndex((wallet) => wallet.id === activeId) : -1;
    const next = {
      id: index >= 0 ? wallets[index].id : randomWalletId(),
      label: index >= 0 ? wallets[index].label : walletLabel(wallets),
      address: checked.address,
      branch: checked.branch,
      index: checked.index,
      vault,
      createdAt: index >= 0 ? wallets[index].createdAt : now,
      updatedAt: now,
    };
    if (index >= 0) wallets[index] = next;
    else wallets.push(next);
    id = next.id;
    await writeWalletState(wallets, id);
    return id;
  }
  return {
    async getAddress() {
      const got = await invokeStore(store, "get", [ADDRESS_KEY], timeoutMs);
      if (!got || got[ADDRESS_KEY] == null) return null;
      return assertStoredAddress(got[ADDRESS_KEY]);
    },
    async getWalletContext(address) {
      const got = await invokeStore(store, "get", [WALLET_CONTEXT_KEY], timeoutMs);
      return validateWalletContext(got?.[WALLET_CONTEXT_KEY], address);
    },
    async setAddress(address, context = null) {
      const value = assertStoredAddress(address);
      const data = { [ADDRESS_KEY]: value };
      data[WALLET_CONTEXT_KEY] = validateWalletContext(context, value);
      // Write the address and identity together so closing the popup cannot mark a watch address as a local wallet.
      await invokeStore(store, "set", [data], timeoutMs);
      if (data[WALLET_CONTEXT_KEY]) await syncActiveWallet(data[WALLET_CONTEXT_KEY]);
    },
    async clearAddress() {
      await invokeStore(store, "remove", [[ADDRESS_KEY, WALLET_CONTEXT_KEY]], timeoutMs);
    },
    async getVault() {
      const got = await invokeStore(store, "get", [VAULT_KEY], timeoutMs);
      return got?.[VAULT_KEY] ?? null;
    },
    async setVault(record) {
      validateVaultRecord(record);
      await invokeStore(store, "set", [{ [VAULT_KEY]: record }], timeoutMs);
    },
    async removeVault() {
      const wallets = await readWallets();
      const activeId = await readActiveWalletId();
      const next = activeId ? wallets.filter((wallet) => wallet.id !== activeId) : wallets;
      await invokeStore(store, "remove", [VAULT_KEY], timeoutMs);
      await writeWalletState(next, null);
    },
    async listLocalWallets() {
      return (await readWallets()).map((wallet) => ({
        id: wallet.id,
        label: wallet.label,
        address: wallet.address,
        branch: wallet.branch,
        index: wallet.index,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
      }));
    },
    async getActiveLocalWalletId() {
      return readActiveWalletId();
    },
    async prepareAddLocalWallet(context) {
      const checked = validateWalletContext(context, context.address);
      if (!checked) throw err("err.storage.addressNotLocalWallet");
      await syncActiveWallet(checked);
      await invokeStore(store, "remove", [VAULT_KEY], timeoutMs);
      await writeWalletState(await readWallets(), null);
    },
    async switchLocalWallet(walletId) {
      if (!validWalletId(walletId)) throw err("err.storage.walletIdInvalid");
      const wallets = await readWallets();
      const target = wallets.find((wallet) => wallet.id === walletId);
      if (!target) throw err("err.storage.walletNotFound");
      await invokeStore(store, "set", [{
        [VAULT_KEY]: target.vault,
        [ADDRESS_KEY]: target.address,
        [WALLET_CONTEXT_KEY]: contextFromWallet(target),
      }], timeoutMs);
      await writeWalletState(wallets, target.id);
      return contextFromWallet(target);
    },
  };
}
