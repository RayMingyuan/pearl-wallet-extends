import { GAP_LIMIT } from "./descriptor.js";

async function yieldMain() {
  const yieldNow = globalThis.scheduler?.yield;
  if (typeof yieldNow === "function") {
    await yieldNow.call(globalThis.scheduler);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const SCAN_BATCH = 8;

// Scan one chain. A new index is returned only after that index itself was
// queried and every index below it was queried. On any gap error, keep the
// caller's previous cursor instead of silently resetting to 0.
// Probes run in small parallel batches — a serial gap of ~40 indexer calls was 10s+.
export async function scanChain(isUsed, gap = GAP_LIMIT, previousNext = 0) {
  const fallback = Number.isInteger(previousNext) && previousNext >= 0 ? previousNext : 0;
  const limit = gap + 100;
  const queried = new Set();
  let maxSeen = -1;
  let unused = 0;
  let index = 0;
  while (unused < gap && index < limit) {
    await yieldMain();
    const batch = [];
    for (let cursor = index; cursor < Math.min(index + SCAN_BATCH, limit); cursor += 1) batch.push(cursor);
    let rows;
    try {
      rows = await Promise.all(batch.map(async (i) => {
        try {
          return { i, used: await isUsed(i) };
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          return { i, error };
        }
      }));
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return { next: fallback, scanned: false };
    }
    for (const row of rows) {
      // A probe past the finished gap must not throw away a completed window.
      if (unused >= gap) break;
      if (row.error) return { next: fallback, scanned: false };
      queried.add(row.i);
      if (row.used) {
        maxSeen = row.i;
        unused = 0;
      } else unused += 1;
      index = row.i + 1;
    }
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
