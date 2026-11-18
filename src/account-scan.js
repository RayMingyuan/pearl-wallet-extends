import { GAP_LIMIT } from "./descriptor.js";

async function yieldMain() {
  const yieldNow = globalThis.scheduler?.yield;
  if (typeof yieldNow === "function") {
    await yieldNow.call(globalThis.scheduler);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Scan one chain. A new index is returned only after that index itself was
// queried and every index below it was queried. On any gap error, keep the
// caller's previous cursor instead of silently resetting to 0.
export async function scanChain(isUsed, gap = GAP_LIMIT, previousNext = 0) {
  const fallback = Number.isInteger(previousNext) && previousNext >= 0 ? previousNext : 0;
  const queried = new Set();
  let maxSeen = -1;
  let unused = 0;
  let index = 0;
  while (unused < gap && index < gap + 100) {
    await yieldMain();
    let used;
    try {
      used = await isUsed(index);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return { next: fallback, scanned: false };
    }
    queried.add(index);
    if (used) {
      maxSeen = index;
      unused = 0;
    } else unused += 1;
    index += 1;
  }
  const next = maxSeen + 1;
  if (!queried.has(next)) return { next: fallback, scanned: false };
  return { next, scanned: true };
}

export function addressLooksUsed(snap) {
  if (!snap || typeof snap !== "object") return false;
  if (Number.isInteger(snap.txCount) && snap.txCount > 0) return true;
  if (typeof snap.balance === "bigint" && snap.balance > 0n) return true;
  if (typeof snap.balance === "string" && /^[1-9]\d*$/.test(snap.balance)) return true;
  return Array.isArray(snap.activity) && snap.activity.length > 0;
}
