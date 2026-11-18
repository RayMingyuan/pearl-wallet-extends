import { err } from "./i18n.js";
import { invokeStore } from "./storage.js";
import { ORIGIN_RE } from "./network-prefs.js";

const TXID_PATTERN = /^[0-9a-f]{64}$/;

function validateRecord(record, network, txid) {
  if (!record || typeof record !== "object") throw err("err.broadcast.journalCorrupt");
  const endpoint = record.endpoint;
  const core = { ...record };
  delete core.endpoint;
  if (Object.keys(core).sort().join() !== "confirmations,network,status,txid"
    || core.network !== network
    || core.txid !== txid
    || !["unknown", "failed", "broadcast"].includes(core.status)
    || !Number.isSafeInteger(core.confirmations)
    || core.confirmations < 0) {
    throw err("err.broadcast.journalCorrupt");
  }
  if (endpoint != null && !ORIGIN_RE.test(endpoint)) {
    throw err("err.broadcast.journalCorrupt");
  }
  return endpoint == null ? core : { ...core, endpoint };
}

function storageKey(network, txid) {
  if (!TXID_PATTERN.test(txid)) throw err("err.tx.txidInvalid");
  const safe = encodeURIComponent(network);
  return { txid, key: `prlJournal:${safe}:${txid}` };
}

export function createBroadcastJournal(network, area = globalThis.chrome?.storage?.local, timeoutMs = 4000) {
  if (!network) throw err("err.broadcast.networkInvalid");
  if (!area) throw err("err.broadcast.journalStorageUnavailable");
  return {
    async get(key) {
      const match = typeof key === "string" ? key.match(/^[^:]+:([0-9a-f]{64})$/) : null;
      if (!match) throw err("err.broadcast.journalKeyInvalid");
      const mapped = storageKey(network, match[1]);
      const got = await invokeStore(area, "get", [mapped.key], timeoutMs);
      if (got?.[mapped.key] == null) return null;
      return validateRecord(got[mapped.key], network, mapped.txid);
    },
    async put(key, value) {
      const match = typeof key === "string" ? key.match(/^[^:]+:([0-9a-f]{64})$/) : null;
      if (!match) throw err("err.broadcast.journalKeyInvalid");
      const mapped = storageKey(network, match[1]);
      const checked = validateRecord(value, network, mapped.txid);
      await invokeStore(area, "set", [{ [mapped.key]: checked }], timeoutMs);
    },
  };
}
