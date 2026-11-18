import { formatGrains, parseUnsignedGrain } from "./amount.js";
import { getLocale, t, err, packMessage } from "./i18n.js";

const TXID = /^[0-9a-fA-F]{64}$/;

function entryValue(entry, own) {
  if (!entry || typeof entry !== "object") return 0n;
  const addresses = Array.isArray(entry.addresses)
    ? entry.addresses.map((item) => String(item).toLowerCase())
    : [];
  const hit = addresses.length > 0 ? addresses.includes(own) : entry.isOwn === true;
  if (!hit) return 0n;
  return parseUnsignedGrain(entry.value, "交易金额");
}

function sumEntries(entries, own) {
  if (!Array.isArray(entries)) throw err("err.activity.txIoMissing");
  let total = 0n;
  for (const entry of entries) total += entryValue(entry, own);
  return total;
}

export function interpretTransaction(tx, ownAddress) {
  if (!tx || typeof tx !== "object" || typeof tx.txid !== "string" || !TXID.test(tx.txid)) {
    throw err("err.activity.txidInvalid");
  }
  const own = ownAddress.toLowerCase();
  const received = sumEntries(tx.vout, own);
  const spent = sumEntries(tx.vin, own);
  const net = received - spent;
  let direction = "self";
  if (net > 0n) direction = "in";
  else if (net < 0n) direction = "out";
  let confirmations = null;
  if (tx.confirmations !== undefined) {
    if (!Number.isInteger(tx.confirmations) || tx.confirmations < 0) {
      throw err("err.activity.confirmationsInvalid");
    }
    confirmations = tx.confirmations;
  }
  let time = null;
  if (tx.blockTime !== undefined && tx.blockTime !== null) {
    if (!Number.isInteger(tx.blockTime) || tx.blockTime < 0) throw err("err.activity.blockTimeInvalid");
    time = tx.blockTime;
  }
  return {
    txid: tx.txid.toLowerCase(),
    direction,
    amount: net < 0n ? -net : net,
    confirmations,
    time,
  };
}

export function interpretTransactions(transactions, ownAddress) {
  if (!Array.isArray(transactions)) {
    return { activity: [], activityError: packMessage("err.activity.dataMissing") };
  }
  try {
    return {
      activity: transactions.map((tx) => interpretTransaction(tx, ownAddress)),
      activityError: null,
    };
  } catch {
    return { activity: [], activityError: packMessage("err.activity.parseFailed") };
  }
}

export function formatBlockTime(unixSeconds, locale = getLocale()) {
  if (!Number.isInteger(unixSeconds) || unixSeconds < 0) return t("activity.time.unknown", undefined, locale);
  const tag = locale === "zh" || String(locale).startsWith("zh") ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(tag, {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
}

export function presentActivity(items) {
  return items.map((item) => {
    const title = item.direction === "in"
      ? t("activity.title.in")
      : item.direction === "out"
        ? t("activity.title.out")
        : t("activity.title.zero");
    const sign = item.direction === "out" ? "−" : item.direction === "in" ? "+" : "";
    const confirmLabel = item.confirmations === 0
      ? t("activity.confirm.unconfirmed")
      : item.confirmations == null
        ? t("activity.confirm.unknown")
        : t("activity.confirm.confirmed");
    const confirmDetail = item.confirmations === 0
      ? t("activity.confirm.unconfirmed")
      : item.confirmations == null
        ? t("activity.confirm.detailUnknown")
        : t("activity.confirm.detailCount", { n: item.confirmations });
    return {
      ...item,
      title,
      amountLabel: `${sign}${formatGrains(item.amount)}`,
      timeLabel: item.time == null ? t("activity.time.pending") : formatBlockTime(item.time),
      confirmLabel,
      confirmDetail,
      txidShort: `${item.txid.slice(0, 8)}…${item.txid.slice(-6)}`,
    };
  });
}

export function applyLatestSpendHint(items, hint) {
  if (hint == null) return items;
  if (!Array.isArray(items)) throw err("err.activity.dataMissing");
  if (!hint || typeof hint !== "object" || Array.isArray(hint) || typeof hint.txid !== "string" || !TXID.test(hint.txid)) {
    throw err("err.activity.spendHintInvalid");
  }
  const txid = hint.txid.toLowerCase();
  const payment = parseUnsignedGrain(hint.payment, "发送金额提示");
  parseUnsignedGrain(hint.fee, "发送手续费提示");
  return items.map((item) => (item.direction === "out" && item.txid === txid
    ? { ...item, amount: payment }
    : item));
}

function signedAmount(item) {
  if (item.direction === "in") return item.amount;
  if (item.direction === "out") return -item.amount;
  return 0n;
}

function mergeMeta(current, next) {
  const confirmations = Number.isInteger(next.confirmations)
    ? next.confirmations
    : current.confirmations;
  const time = Number.isInteger(next.time) ? next.time : current.time;
  return {
    confirmations: Number.isInteger(current.confirmations) && Number.isInteger(confirmations)
      ? Math.max(current.confirmations, confirmations)
      : confirmations,
    time: Number.isInteger(current.time) && Number.isInteger(time)
      ? Math.max(current.time, time)
      : time,
  };
}

export function mergeActivityGroups(groups) {
  if (!Array.isArray(groups)) throw err("err.activity.groupsMissing");
  const byTxid = new Map();
  for (const group of groups) {
    if (!Array.isArray(group)) throw err("err.activity.groupsMissing");
    for (const item of group) {
      if (!item || typeof item !== "object" || typeof item.txid !== "string" || !TXID.test(item.txid)
        || !["in", "out", "self"].includes(item.direction) || typeof item.amount !== "bigint" || item.amount < 0n) {
        throw err("err.activity.mergeFailed");
      }
      const txid = item.txid.toLowerCase();
      const current = byTxid.get(txid) ?? { txid, net: 0n, confirmations: null, time: null };
      const meta = mergeMeta(current, item);
      byTxid.set(txid, { ...current, ...meta, net: current.net + signedAmount(item) });
    }
  }
  return Array.from(byTxid.values())
    .map(({ txid, net, confirmations, time }) => ({
      txid,
      direction: net > 0n ? "in" : net < 0n ? "out" : "self",
      amount: net < 0n ? -net : net,
      confirmations,
      time,
    }))
    .sort((a, b) => {
      const at = Number.isInteger(a.time) ? a.time : -1;
      const bt = Number.isInteger(b.time) ? b.time : -1;
      if (at !== bt) return bt - at;
      return a.txid.localeCompare(b.txid);
    });
}

export function filterActivity(items, filter) {
  if (filter === "in") return items.filter((item) => item.direction === "in");
  if (filter === "out") return items.filter((item) => item.direction === "out");
  return items;
}
