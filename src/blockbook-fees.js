import { err } from "./i18n.js";
import { BLOCKBOOK_ORIGIN } from "./blockbook.js";

// btcd/bitcoind estimatefee returns coin per kilobyte. Blockbook passes that
// decimal through. 1 PRL = 1e8 grain, so grain/vB = ceil(PRL/kvB * 1e5).
export function prlPerKvBToGrainPerVb(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw err("err.blockbook.feeRateNotDecimal");
  }
  const [whole, fraction = ""] = value.split(".");
  const head = (fraction + "00000").slice(0, 5);
  let rate = BigInt(whole) * 100_000n + BigInt(head);
  if (/[1-9]/.test(fraction.slice(5))) rate += 1n;
  if (rate < 1n || rate > 10_000n) throw err("err.blockbook.feeRateOutOfRange");
  return Number(rate);
}

const FALLBACK = { slow: 2, standard: 8, fast: 20 };

export async function fetchFeeMenu(fetchImpl = globalThis.fetch, origin = BLOCKBOOK_ORIGIN) {
  const blocks = { slow: 18, standard: 6, fast: 2 };
  const menu = {};
  let failed = false;
  for (const [name, count] of Object.entries(blocks)) {
    try {
      const response = await fetchImpl(`${origin}/api/v2/estimatefee/${count}`, { cache: "no-store" });
      const body = JSON.parse(await response.text());
      if (!response.ok) throw err("err.blockbook.feeHttp");
      menu[name] = prlPerKvBToGrainPerVb(body.result);
    } catch {
      failed = true;
      menu[name] = FALLBACK[name];
    }
  }
  return { menu, fallback: failed, note: failed
    ? "节点 estimatefee 不可用，慢/标准/快暂用 2/8/20 grain/vB，可改自定义费率。"
    : "慢/标准/快来自 estimatefee 18/6/2 个块，按 btcd 的 PRL/kvB 向上取整为 grain/vB。" };
}
