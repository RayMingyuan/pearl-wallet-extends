import { invokeStore } from "./storage.js";

export function createSimnetStore(session, area = globalThis.chrome?.storage?.local, timeoutMs = 4000) {
  if (!/^[0-9a-f]{32}$/.test(session) || !area) throw new Error("本地链日志存储不可用");
  const storageKey = `prlSimnetJournal:${session}`;
  function validate(value) {
    if (!value || Object.keys(value).sort().join() !== "confirmations,network,status,txid"
      || value.network !== "Pearl simnet" || !/^[0-9a-f]{64}$/.test(value.txid)
      || !["unknown", "failed", "broadcast"].includes(value.status)
      || !Number.isSafeInteger(value.confirmations) || value.confirmations < 0) throw new Error("本地链广播日志损坏，不能重新发送");
    return value;
  }
  async function read() {
    const result = await invokeStore(area, "get", [storageKey], timeoutMs);
    return result?.[storageKey] == null ? null : validate(result[storageKey]);
  }
  return {
    read,
    async get(key) {
      const record = await read();
      if (record && key !== `simnet:${record.txid}`) throw new Error("本会话已有另一笔广播记录");
      return record;
    },
    async put(key, value) {
      validate(value);
      if (key !== `simnet:${value.txid}`) throw new Error("广播日志键不匹配");
      await invokeStore(area, "set", [{ [storageKey]: value }], timeoutMs);
    },
  };
}
