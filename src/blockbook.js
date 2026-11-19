import { err } from "./i18n.js";
import { parseSignedGrain, parseUnsignedGrain } from "./amount.js";
import { interpretTransactions } from "./activity.js";
import { taprootScript, verifyUtxos } from "./transaction.js";

export const BLOCKBOOK_ORIGIN = "https://blockbook.pearlresearch.ai";

export class BlockbookError extends Error {
  constructor(message, { kind, status = 0 } = {}) {
    super(message);
    this.name = "BlockbookError";
    this.kind = kind;
    this.status = status;
  }
}

function failureMessage(kind, status) {
  if (kind === "network") return "连不上索引节点";
  if (kind === "parse") return "索引节点没有返回 JSON";
  if (kind === "rejected") return "索引节点拒绝了这个地址";
  if (kind === "shape") return "索引节点的余额字段无法读取";
  return `索引节点返回 HTTP ${status}`;
}

async function readJson(response) {
  let text;
  try {
    text = await response.text();
  } catch {
    throw new BlockbookError(failureMessage("parse", response.status), {
      kind: "parse",
      status: response.status,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new BlockbookError(failureMessage("parse", response.status), {
      kind: "parse",
      status: response.status,
    });
  }
}

export function parseAddressPayload(body, address) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BlockbookError(failureMessage("shape"), { kind: "shape" });
  }
  let balance;
  let unconfirmedBalance = null;
  try {
    balance = parseUnsignedGrain(body.balance, "balance");
    if (body.unconfirmedBalance !== undefined && body.unconfirmedBalance !== null) {
      unconfirmedBalance = parseSignedGrain(body.unconfirmedBalance, "unconfirmedBalance");
    }
  } catch {
    throw new BlockbookError(failureMessage("shape"), { kind: "shape" });
  }
  const txCount = Number.isInteger(body.txs) && body.txs >= 0 ? body.txs : null;
  // Blockbook omits `transactions` for unused addresses (txs === 0). Treat that as an empty list so gap
  // scans can mark the address unused instead of aborting the whole receive/change cursor.
  const transactions = Array.isArray(body.transactions)
    ? body.transactions
    : (txCount === 0 ? [] : body.transactions);
  const interpreted = interpretTransactions(transactions, address);
  return {
    balance,
    unconfirmedBalance,
    txCount,
    activity: interpreted.activity,
    activityError: interpreted.activityError,
  };
}

export async function fetchWatchAddress(address, {
  fetchImpl = globalThis.fetch,
  origin = BLOCKBOOK_ORIGIN,
  pageSize = 20,
  signal,
} = {}) {
  const size = Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 25 ? pageSize : 20;
  const url = `${origin}/api/v2/address/${encodeURIComponent(address)}?details=txslight&pageSize=${size}`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new BlockbookError(failureMessage("network"), { kind: "network" });
  }
  const body = await readJson(response);
  if (!response.ok) {
    const kind = response.status === 400 ? "rejected" : "http";
    throw new BlockbookError(failureMessage(kind, response.status), {
      kind,
      status: response.status,
    });
  }
  return parseAddressPayload(body, address);
}

export async function fetchSpendableUtxos(address, { fetchImpl = globalThis.fetch, signal, origin = BLOCKBOOK_ORIGIN, network = "Pearl mainnet" } = {}) {
  taprootScript(address, network);
  const request = async (path) => {
    const response = await fetchImpl(`${origin}/api/v2/${path}`, {
      method: "GET", headers: { Accept: "application/json" }, cache: "no-store", referrerPolicy: "no-referrer", signal,
    });
    if (!response.ok) throw err("err.blockbook.utxoHttp", { status: response.status });
    const text = await response.text();
    if (text.length > 1000000) throw err("err.blockbook.payloadTooLarge");
    try { return JSON.parse(text); }
    catch { throw err("err.blockbook.utxoJsonInvalid"); }
  };
  const records = await request(`utxo/${encodeURIComponent(address)}?confirmed=true`);
  if (!Array.isArray(records) || records.length > 100) throw err("err.blockbook.utxoListInvalid");
  const raw = new Map();
  const result = new Array(records.length);
  let next = 0;
  let failure;
  // Four workers share one Promise per previous transaction. A failure or cancel does not queue another request.
  async function worker() {
    while (next < records.length && !failure) {
      const index = next++;
      const record = records[index];
      if (signal?.aborted) throw err("err.blockbook.utxoAborted");
      if (!record || !/^[0-9a-f]{64}$/.test(record.txid)) throw err("err.blockbook.utxoIdInvalid");
      if (!raw.has(record.txid)) {
        raw.set(record.txid, request(`tx/${record.txid}`).then((transaction) => {
          if (transaction?.txid !== record.txid || typeof transaction.hex !== "string") throw err("err.blockbook.prevTxMismatch");
          return transaction.hex;
        }));
      }
      result[index] = { ...record, prevTxHex: await raw.get(record.txid) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, records.length) }, () => worker().catch((error) => { failure ??= error; })));
  if (failure) throw failure;
  return verifyUtxos(result, address, network);
}
