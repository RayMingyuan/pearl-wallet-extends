export const SIMNET_BRIDGE_ORIGIN = "http://127.0.0.1:18765";

export function createSimnetClient(token, { fetchImpl = globalThis.fetch } = {}) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("配对码须为本次桥接生成的 64 位十六进制字符串");
  const controller = new AbortController();
  let session;
  async function request(path, value) {
    if (controller.signal.aborted) throw new Error("本地桥接会话已断开");
    const timeout = new AbortController();
    const abort = () => timeout.abort();
    controller.signal.addEventListener("abort", abort, { once: true });
    if (controller.signal.aborted) timeout.abort();
    const timer = setTimeout(abort, 20000);
    try {
      const response = await fetchImpl(`${SIMNET_BRIDGE_ORIGIN}/${path}`, { method: value ? "POST" : "GET",
        redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", credentials: "omit",
        headers: { Authorization: `Bearer ${token}`, ...(value ? { "Content-Type": "application/json" } : {}) },
        ...(value ? { body: JSON.stringify({ ...value, session }) } : {}), signal: timeout.signal });
      if (!response.ok) throw new Error(`本地桥接返回 HTTP ${response.status}；已发送请求时请查证状态`);
      const text = await response.text();
      if (text.length > 1000000) throw new Error("本地桥接响应过大");
      try { return JSON.parse(text); } catch { throw new Error("本地桥接返回的 JSON 无效"); }
    } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); }
  }
  return {
    async connect() {
      const result = await request("session");
      if (result?.network !== "Pearl simnet" || !/^[0-9a-f]{32}$/.test(result.id)) throw new Error("桥接不是有效的 simnet 会话");
      session = result.id;
      return result;
    },
    async preflight(rawHex) { return (await request("preflight", { rawHex })).accepted; },
    async send(rawHex) { return (await request("send", { rawHex })).txid; },
    async lookup(txid) { return (await request("lookup", { txid })).found; },
    close() { token = ""; controller.abort(); },
  };
}
