import { err } from "./i18n.js";
import { invokeStore } from "./storage.js";
import { validatePearlMainnetAddress } from "./address.js";
import { parseUnsignedGrain } from "./amount.js";

const KEY_PATTERN = /^mainnet:([0-9a-f]{64})$/;
const TXID_PATTERN = /^[0-9a-f]{64}$/;
const ADDRESS_INDEX_PREFIX = "prlMainnetLastByAddress:";
const SPEND_HINT_PREFIX = "prlMainnetSpendHint:";

function validateRecord(record, txid) {
  if (!record || typeof record !== "object") throw err("err.mainnet.journalCorrupt");
  const endpoint = record.endpoint;
  const core = { ...record };
  delete core.endpoint;
  if (Object.keys(core).sort().join() !== "confirmations,network,status,txid"
    || core.network !== "Pearl mainnet"
    || core.txid !== txid
    || !["unknown", "failed", "broadcast"].includes(core.status)
    || !Number.isSafeInteger(core.confirmations)
    || core.confirmations < 0) {
    throw err("err.mainnet.journalCorrupt");
  }
  if (endpoint != null && !/^https:\/\/[A-Za-z0-9.-]+$/.test(endpoint)) {
    throw err("err.mainnet.journalCorrupt");
  }
  return endpoint == null ? core : { ...core, endpoint };
}

function storageKey(key) {
  const match = typeof key === "string" ? key.match(KEY_PATTERN) : null;
  if (!match) throw err("err.mainnet.journalKeyInvalid");
  return { txid: match[1], key: `prlMainnetJournal:${match[1]}` };
}

function normalizeAddress(address) {
  const parsed = validatePearlMainnetAddress(address);
  if (!parsed.ok) throw err("err.mainnet.addressInvalid", { detail: parsed.error });
  return parsed.address;
}

function normalizeTxid(txid) {
  const value = typeof txid === "string" ? txid.trim().toLowerCase() : "";
  if (!TXID_PATTERN.test(value)) throw err("err.mainnet.txidInvalid");
  return value;
}

function addressKey(address) {
  return `${ADDRESS_INDEX_PREFIX}${normalizeAddress(address)}`;
}

async function readAll(area, timeoutMs) {
  const got = await invokeStore(area, "get", [null], timeoutMs);
  return got && typeof got === "object" ? got : {};
}

function addressesMappedToTxid(all, txid) {
  const addresses = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(ADDRESS_INDEX_PREFIX)) continue;
    if (value !== txid) continue;
    const raw = key.slice(ADDRESS_INDEX_PREFIX.length);
    try {
      addresses.push(normalizeAddress(raw));
    } catch {
      // Ignore corrupt historical rows so a normal address can still be shown.
    }
  }
  return Array.from(new Set(addresses));
}

function spendHintKey(txid) {
  return `${SPEND_HINT_PREFIX}${normalizeTxid(txid)}`;
}

function normalizeSpendHint(value, txid) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw err("err.mainnet.spendHintInvalid");
  }
  const shape = Object.keys(value).sort().join();
  if (shape !== "fee,payment,txid" && shape !== "changeAddress,fee,payment,sourceAddress,txid") {
    throw err("err.mainnet.spendHintInvalid");
  }
  const payment = parseUnsignedGrain(value.payment, "主网发送金额");
  const fee = parseUnsignedGrain(value.fee, "主网发送手续费");
  if (payment <= 0n || value.txid !== txid) throw err("err.mainnet.spendHintInvalid");
  const normalized = { txid, payment: payment.toString(), fee: fee.toString() };
  if (shape === "changeAddress,fee,payment,sourceAddress,txid") {
    const sourceAddress = normalizeAddress(value.sourceAddress);
    const changeAddress = normalizeAddress(value.changeAddress);
    if (sourceAddress === changeAddress) throw err("err.mainnet.spendHintInvalid");
    normalized.sourceAddress = sourceAddress;
    normalized.changeAddress = changeAddress;
  }
  return Object.freeze(normalized);
}

export function createMainnetStore(area = globalThis.chrome?.storage?.local, timeoutMs = 4000) {
  if (!area) throw err("err.mainnet.journalStorageUnavailable");
  async function getByTxid(txid) {
    const mapped = storageKey(`mainnet:${txid}`);
    const got = await invokeStore(area, "get", [mapped.key], timeoutMs);
    if (got?.[mapped.key] == null) return null;
    return validateRecord(got[mapped.key], mapped.txid);
  }
  return {
    async get(key) {
      const mapped = storageKey(key);
      const got = await invokeStore(area, "get", [mapped.key], timeoutMs);
      if (got?.[mapped.key] == null) return null;
      return validateRecord(got[mapped.key], mapped.txid);
    },
    async put(key, value) {
      const mapped = storageKey(key);
      const checked = validateRecord(value, mapped.txid);
      await invokeStore(area, "set", [{ [mapped.key]: checked }], timeoutMs);
    },
    async rememberLatest(address, txid, spendHint = null) {
      const target = normalizeTxid(txid);
      const data = { [addressKey(address)]: target };
      if (spendHint != null) {
        const normalized = normalizeSpendHint({
          txid: target,
          payment: spendHint.payment,
          fee: spendHint.fee,
          sourceAddress: spendHint.sourceAddress,
          changeAddress: spendHint.changeAddress,
        }, target);
        data[spendHintKey(target)] = normalized;
        if (normalized.sourceAddress && normalized.changeAddress) {
          data[addressKey(normalized.sourceAddress)] = target;
          data[addressKey(normalized.changeAddress)] = target;
        }
      }
      await invokeStore(area, "set", [data], timeoutMs);
    },
    async getLatestForAddress(address) {
      const key = addressKey(address);
      const got = await invokeStore(area, "get", [key], timeoutMs);
      if (got?.[key] == null) return null;
      const txid = normalizeTxid(got[key]);
      return getByTxid(txid);
    },
    async getLatestSpendHintForAddress(address) {
      const key = addressKey(address);
      const got = await invokeStore(area, "get", [key], timeoutMs);
      if (got?.[key] == null) return null;
      const txid = normalizeTxid(got[key]);
      const spendKey = spendHintKey(txid);
      const mapped = await invokeStore(area, "get", [spendKey], timeoutMs);
      if (mapped?.[spendKey] == null) return null;
      return normalizeSpendHint(mapped[spendKey], txid);
    },
    async getLatestAddressGroupForAddress(address) {
      const current = normalizeAddress(address);
      const key = addressKey(current);
      const got = await invokeStore(area, "get", [key], timeoutMs);
      if (got?.[key] == null) return [current];
      const txid = normalizeTxid(got[key]);
      const all = await readAll(area, timeoutMs);
      const group = addressesMappedToTxid(all, txid);
      return group.length ? group : [current];
    },
    async linkLatestAddresses(sourceAddress, peerAddress) {
      const source = normalizeAddress(sourceAddress);
      const peer = normalizeAddress(peerAddress);
      if (source === peer) return false;
      const sourceKey = addressKey(source);
      const got = await invokeStore(area, "get", [sourceKey], timeoutMs);
      if (got?.[sourceKey] == null) return false;
      const txid = normalizeTxid(got[sourceKey]);
      await invokeStore(area, "set", [{ [addressKey(peer)]: txid }], timeoutMs);
      return true;
    },
  };
}
