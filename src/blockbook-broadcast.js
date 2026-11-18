import { err } from "./i18n.js";
import { BLOCKBOOK_ORIGIN } from "./blockbook.js";

const TXID_PATTERN = /^[0-9a-f]{64}$/;
const HEX_PATTERN = /^(?:[0-9a-fA-F]{2})+$/;

export class BlockbookBroadcastError extends Error {
  constructor(message, { kind, status = 0 } = {}) {
    super(message);
    this.name = "BlockbookBroadcastError";
    this.kind = kind;
    this.status = status;
  }
}

function failureMessage(kind, status) {
  if (kind === "network") return "连不上索引节点";
  if (kind === "parse") return "索引节点返回的广播响应无法解析";
  if (kind === "rejected") return "索引节点拒绝了这笔交易";
  if (kind === "shape") return "索引节点返回的广播结果无法校验";
  return `索引节点返回 HTTP ${status}`;
}

function normalizeTxid(value) {
  if (typeof value !== "string") return null;
  const txid = value.trim().toLowerCase();
  return TXID_PATTERN.test(txid) ? txid : null;
}

function validateRawHex(rawHex) {
  if (typeof rawHex !== "string" || rawHex.length < 2 || rawHex.length > 8_000_000 || !HEX_PATTERN.test(rawHex)) {
    throw err("err.tx.hexInvalid");
  }
  return rawHex.toLowerCase();
}

async function readText(response) {
  try {
    const text = await response.text();
    if (text.length > 1_000_000) {
      throw new BlockbookBroadcastError(failureMessage("shape"), { kind: "shape", status: response.status });
    }
    return text;
  } catch (error) {
    if (error instanceof BlockbookBroadcastError) throw error;
    throw new BlockbookBroadcastError(failureMessage("parse"), { kind: "parse", status: response.status });
  }
}

function parseJson(text, status) {
  try {
    return JSON.parse(text);
  } catch {
    throw new BlockbookBroadcastError(failureMessage("parse"), { kind: "parse", status });
  }
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractErrorMessage(body, fallbackText) {
  if (body && typeof body === "object" && !Array.isArray(body) && typeof body.error === "string" && body.error.trim()) {
    return body.error.trim();
  }
  if (typeof body === "string" && body.trim()) return body.trim();
  if (typeof fallbackText === "string" && fallbackText.trim()) return fallbackText.trim();
  return null;
}

function txidFromSendPayload(body, text) {
  const direct = normalizeTxid(text);
  if (direct) return direct;
  if (typeof body === "string") return normalizeTxid(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return normalizeTxid(body.txid) ?? normalizeTxid(body.result);
}

export async function sendRawTransaction(rawHex, { fetchImpl = globalThis.fetch, origin = BLOCKBOOK_ORIGIN } = {}) {
  const payload = validateRawHex(rawHex);
  let response;
  try {
    response = await fetchImpl(`${origin}/api/v2/sendtx/`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "text/plain;charset=UTF-8",
      },
      body: payload,
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new BlockbookBroadcastError(failureMessage("network"), { kind: "network" });
  }

  const text = await readText(response);
  const body = tryParseJson(text);
  if (!response.ok) {
    const kind = response.status >= 400 && response.status < 500 ? "rejected" : "http";
    throw new BlockbookBroadcastError(failureMessage(kind, response.status), {
      kind,
      status: response.status,
    });
  }

  const txid = txidFromSendPayload(body, text);
  if (!txid) {
    throw new BlockbookBroadcastError(failureMessage("shape"), { kind: "shape", status: response.status });
  }
  return txid;
}

export async function lookupTransaction(txid, { fetchImpl = globalThis.fetch, origin = BLOCKBOOK_ORIGIN } = {}) {
  const expected = normalizeTxid(txid);
  if (!expected) throw err("err.tx.txidInvalid");
  let response;
  try {
    response = await fetchImpl(`${origin}/api/v2/tx/${expected}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } catch {
    throw new BlockbookBroadcastError(failureMessage("network"), { kind: "network" });
  }

  const text = await readText(response);
  const body = parseJson(text, response.status);
  if (!response.ok) {
    const message = extractErrorMessage(body, text);
    if ((response.status === 400 || response.status === 404) && /not found/i.test(message || "")) return null;
    const kind = response.status >= 400 && response.status < 500 ? "rejected" : "http";
    throw new BlockbookBroadcastError(failureMessage(kind, response.status), {
      kind,
      status: response.status,
    });
  }

  const found = normalizeTxid(body?.txid);
  const confirmations = body?.confirmations;
  if (found !== expected || !Number.isSafeInteger(confirmations) || confirmations < 0) {
    throw new BlockbookBroadcastError(failureMessage("shape"), { kind: "shape", status: response.status });
  }
  return Object.freeze({ txid: found, confirmations });
}

export function createBlockbookBroadcastTransport({ origin = BLOCKBOOK_ORIGIN, fetchImpl } = {}) {
  const current = () => (typeof origin === "function" ? origin() : origin);
  return {
    endpoint() { return current(); },
    async preflight(rawHex) {
      validateRawHex(rawHex);
      return true;
    },
    async send(rawHex) {
      return sendRawTransaction(rawHex, { origin: current(), fetchImpl });
    },
    async lookup(txid) {
      return lookupTransaction(txid, { origin: current(), fetchImpl });
    },
  };
}
