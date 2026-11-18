import { err } from "./i18n.js";
import { getNetwork } from "./networks.js";
import { verifySignedTransaction } from "./transaction.js";

function validateRecord(record, network, txid) {
  if (!record || typeof record !== "object") throw err("err.broadcast.recordCorrupt");
  const endpoint = record.endpoint;
  const core = { ...record };
  delete core.endpoint;
  if (Object.keys(core).sort().join() !== "confirmations,network,status,txid"
    || core.network !== network || core.txid !== txid
    || !["unknown", "failed", "broadcast"].includes(core.status)
    || !Number.isSafeInteger(core.confirmations) || core.confirmations < 0) {
    throw err("err.broadcast.recordCorrupt");
  }
  if (endpoint != null && !/^https?:\/\/(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9.-]+)(?::\d{1,5})?$/.test(endpoint)) {
    throw err("err.broadcast.recordCorrupt");
  }
  return Object.freeze(endpoint == null ? { ...core } : { ...core, endpoint });
}

// Local-chain only. The production extension entry does not import this module. The persisted log stores neither raw hex nor secrets.
function createBroadcaster({ network, store, withLock, transport, supportedChains, unsupportedMessage }) {
  const params = getNetwork(network);
  if (!supportedChains.includes(params.chain)) throw err(unsupportedMessage);
  if (typeof withLock !== "function") throw err("err.broadcast.needSerialLock");
  const key = (txid) => {
    if (!/^[0-9a-f]{64}$/.test(txid)) throw err("err.tx.txidInvalid");
    return `${params.chain}:${txid}`;
  };
  const save = async (record) => {
    const checked = validateRecord(record, network, record.txid);
    await store.put(key(record.txid), checked);
    return checked;
  };
  return {
    async submit({ draft, signed, confirmedTxid }) {
      if (draft.network !== network) throw err("err.broadcast.draftNetworkMismatch");
      const transaction = verifySignedTransaction(draft, signed);
      if (confirmedTxid !== transaction.txid) throw err("err.broadcast.confirmTxid");
      const txid = transaction.txid;
      return withLock(key(txid), async () => {
        const previous = await store.get(key(txid));
        if (previous != null) return validateRecord(previous, network, txid);
        // Persist status "unknown" first. After a crash, timeout, or lost response, only a lookup is allowed, never an automatic resend.
        const endpoint = typeof transport.endpoint === "function" ? transport.endpoint() : undefined;
        let record = await save({
          network, txid, status: "unknown", confirmations: 0, ...(endpoint ? { endpoint } : {}),
        });
        try {
          const accepted = await transport.preflight(transaction.rawHex);
          if (accepted === false) {
            // Preflight also rejects a transaction already in the mempool or on chain. Look it up before reporting failure.
            const found = await transport.lookup(txid);
            if (found === null) return await save({ ...record, status: "failed" });
            if (found?.txid === txid && Number.isSafeInteger(found.confirmations) && found.confirmations >= 0) {
              return await save({ ...record, status: "broadcast", confirmations: found.confirmations });
            }
            return record;
          }
          if (accepted !== true) return record;
          const returnedId = await transport.send(transaction.rawHex);
          if (returnedId !== txid) return record;
          const found = await transport.lookup(txid);
          if (found?.txid === txid && Number.isSafeInteger(found.confirmations) && found.confirmations >= 0) {
            record = await save({ ...record, status: "broadcast", confirmations: found.confirmations });
          }
        } catch {
          // An RPC error from send can also mean the transaction is already in the mempool or on chain. Do not treat that as a failure.
        }
        return record;
      });
    },
    async refresh(txid) {
      return withLock(key(txid), async () => {
        const previous = await store.get(key(txid));
        const record = validateRecord(previous, network, txid);
        if (record.status === "failed") return record;
        try {
          const found = await transport.lookup(txid);
          if (found?.txid === txid && Number.isSafeInteger(found.confirmations) && found.confirmations >= 0) {
            return await save({ ...record, status: "broadcast", confirmations: found.confirmations });
          }
        } catch { /* A lookup failure does not resend, and it does not erase earlier evidence of acceptance. */ }
        return record;
      });
    },
  };
}

// Local-chain only. The production extension entry does not import this module. The persisted log stores neither raw hex nor secrets.
export function createLocalBroadcaster(options) {
  return createBroadcaster({
    ...options,
    supportedChains: ["regtest", "simnet"],
    unsupportedMessage: "err.broadcast.unsupportedChain",
  });
}

export function createMainnetBroadcaster(options) {
  return createBroadcaster({
    ...options,
    supportedChains: ["mainnet"],
    unsupportedMessage: "err.broadcast.unsupportedMainnet",
  });
}

export function createPublicBroadcaster(options) {
  return createBroadcaster({
    ...options,
    supportedChains: ["mainnet", "testnet", "testnet2"],
    unsupportedMessage: "err.broadcast.unsupportedMainnetTestnet",
  });
}
