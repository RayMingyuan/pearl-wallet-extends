import { err } from "./i18n.js";
import { bindDeadline } from "./abort-deadline.js";
import { BLOCKBOOK_ORIGIN } from "./blockbook.js";

// btcd/bitcoind estimatefee returns coin per kilobyte. Blockbook passes that
// decimal through. 1 PRL = 1e8 grain, so grain/vB = ceil(PRL/kvB * 1e5).
export function prlPerKvBToGrainPerVb(value) {
  const text = normalizeEstimateResult(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) {
    throw err("err.blockbook.feeRateNotDecimal");
  }
  const [whole, fraction = ""] = text.split(".");
  const head = (fraction + "00000").slice(0, 5);
  let rate = BigInt(whole) * 100_000n + BigInt(head);
  if (/[1-9]/.test(fraction.slice(5))) rate += 1n;
  if (rate < 1n || rate > 10_000n) throw err("err.blockbook.feeRateOutOfRange");
  return Number(rate);
}

// Blockbook usually returns a decimal string; some builds may pass a JSON number.
// bitcoind-style "-1" / -1 means "no estimate".
function normalizeEstimateResult(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw err("err.blockbook.feeRateNotDecimal");
    if (value === 0) throw err("err.blockbook.feeRateOutOfRange");
    return value.toFixed(8);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "-1") throw err("err.blockbook.feeRateNotDecimal");
    return trimmed;
  }
  throw err("err.blockbook.feeRateNotDecimal");
}

// Match the official desktop wallet: Fast ~1 / Medium ~10 / Slow ~25 blocks.
export const FEE_BLOCKS = { slow: 25, standard: 10, fast: 1 };

// Cold presets when estimatefee is down and we have no prior live menu.
// Floor is 1 grain/vB. Fast sits above the Codex ~51 “typical next block” snapshot
// so “快” still aims to confirm when the indexer is silent — not a live quote.
export const FEE_FALLBACK = { slow: 1, standard: 10, fast: 100 };
export const FEE_MENU_CACHE_MS = 45_000;

let feeCache = null;
let lastLive = null;

export function expireFeeMenuCache() {
  feeCache = null;
}

export function clearFeeMenuCache() {
  feeCache = null;
  lastLive = null;
}

function substituteRate(name, origin) {
  if (lastLive && lastLive.origin === origin && Number.isInteger(lastLive.menu[name])) {
    return lastLive.menu[name];
  }
  return FEE_FALLBACK[name];
}

async function estimateOne(fetchImpl, origin, blocks, timeoutMs) {
  const response = await fetchImpl(`${origin}/api/v2/estimatefee/${blocks}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal: bindDeadline(undefined, timeoutMs),
  });
  const body = JSON.parse(await response.text());
  if (!response.ok) throw err("err.blockbook.feeHttp");
  return prlPerKvBToGrainPerVb(body.result);
}

export async function fetchFeeMenu(fetchImpl = globalThis.fetch, origin = BLOCKBOOK_ORIGIN, { timeoutMs = 5_000 } = {}) {
  if (feeCache && feeCache.origin === origin && Date.now() - feeCache.at < FEE_MENU_CACHE_MS) {
    return feeCache.result;
  }
  const entries = await Promise.all(Object.entries(FEE_BLOCKS).map(async ([name, count]) => {
    try {
      return [name, await estimateOne(fetchImpl, origin, count, timeoutMs), false];
    } catch {
      return [name, substituteRate(name, origin), true];
    }
  }));
  const menu = {};
  let failed = false;
  let usedHardFallback = false;
  for (const [name, rate, miss] of entries) {
    menu[name] = rate;
    if (miss) {
      failed = true;
      if (!(lastLive && lastLive.origin === origin)) usedHardFallback = true;
    }
  }
  const result = {
    menu,
    fallback: failed,
    note: failed
      ? (usedHardFallback
        ? `节点 estimatefee 不可用，慢/标准/快暂用 ${FEE_FALLBACK.slow}/${FEE_FALLBACK.standard}/${FEE_FALLBACK.fast} grain/vB，可改自定义费率。`
        : "节点 estimatefee 部分不可用，缺口沿用上次成功费率，可改自定义费率。")
      : "慢/标准/快来自 estimatefee 25/10/1 个块，按 btcd 的 PRL/kvB 向上取整为 grain/vB。",
  };
  // Only cache clean live menus. Caching fallbacks made a transient blip sticky for 45s.
  if (!failed) {
    lastLive = { origin, menu: { ...menu } };
    feeCache = { origin, at: Date.now(), result };
  }
  return result;
}
