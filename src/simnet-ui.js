import { createLocalBroadcaster } from "./broadcast.js";
import { formatGrains } from "./amount.js";
import { decodeTransaction } from "./transaction.js";
import { createSimnetClient } from "./simnet-client.js";
import { createSimnetStore } from "./simnet-storage.js";
import { signSimnetFixture, validateSimnetFixture } from "./simnet-fixture.js";

export function mountSimnet(document, { createClient = createSimnetClient, createStore = createSimnetStore,
  sign = signSimnetFixture, locks = globalThis.navigator?.locks, now = Date.now } = {}) {
  const get = (id) => document.getElementById(`simnet-${id}`);
  let state;
  let client;
  let lifetime;
  let generation = 0;
  let busy = false;
  let pending = Promise.resolve();
  function render() {
    get("pair").disabled = busy || Boolean(client);
    get("connect").disabled = busy || Boolean(client);
    get("review").hidden = !state;
    get("sign-confirm").disabled = busy || !state || Boolean(state.signed || state.record);
    get("send-confirm").disabled = busy || !state?.signed || Boolean(state?.record);
    get("sign").disabled = busy || !state || Boolean(state.signed || state.record);
    get("send").disabled = busy || !state?.signed || Boolean(state?.record);
    get("refresh").disabled = busy || !state?.record;
    get("status").textContent = busy ? "正在处理；已发送请求时，重开后请配对并查证状态。" : !state ? "未连接" : !state.record
      ? state.signed ? `已签名，尚未广播。交易 ID：${state.signed.txid}` : "草稿就绪，尚未签名或广播。"
      : `${{ unknown: "状态未知，请查证，禁止重新发送", failed: "失败：节点预检拒绝，未发送", broadcast: "已广播，节点已接收" }[state.record.status]}；确认数：${state.record.confirmations}；交易 ID：${state.record.txid}`;
  }
  function clear() {
    generation += 1;
    lifetime?.abort(); client?.close(); client = null; state = null; busy = false;
    get("pair").value = ""; get("sign-confirm").checked = false; get("send-confirm").checked = false;
    get("summary").textContent = ""; get("error").textContent = ""; render();
  }
  function track(work) {
    if (busy) return;
    const current = generation;
    busy = true; get("error").textContent = ""; render();
    pending = Promise.resolve().then(() => current === generation ? work(current) : undefined).catch((error) => {
      if (current === generation) get("error").textContent = error instanceof Error ? error.message : "本地测试操作失败";
    }).finally(() => { if (current === generation) { busy = false; render(); } });
  }
  get("connect").addEventListener("click", () => track(async (current) => {
    if (!locks?.request) throw new Error("浏览器缺少 Web Locks，未连接广播会话");
    const token = get("pair").value.trim(); get("pair").value = "";
    lifetime = new AbortController();
    const next = createClient(token); client = next;
    try {
      const session = await next.connect();
      if (current !== generation) return;
      const draft = validateSimnetFixture(session.draft);
      const store = createStore(session.id);
      const record = await store.read();
      if (current !== generation) return;
      if (record && record.txid !== decodeTransaction(draft.unsignedHex).txid) throw new Error("本会话日志与固定交易不匹配");
      const broadcaster = createLocalBroadcaster({ network: "Pearl simnet", store, transport: next,
        withLock(key, work) { return locks.request(`prl-simnet:${session.id}:${key}`, { mode: "exclusive" }, work); } });
      state = { draft, broadcaster, record, created: now(), signed: null };
      const prl = (value) => `${formatGrains(BigInt(value))} PEARL`;
      get("summary").textContent = ["网络：Pearl simnet（本地测试币）", `来源：${draft.sourceAddress}`,
        `收款：${draft.destination}`, `金额：${prl(draft.payment)}`, `手续费：${prl(draft.fee)}；${draft.feeRate} grain/vB；${draft.vsize} vB`,
        `找零：${prl(draft.change)} → ${draft.changeAddress}`, "固定公开夹具；账户 0，来源 0/0，找零 1/0。草稿 2 分钟后需重新配对。"].join("\n");
    } catch (error) { next.close(); if (current === generation) client = null; throw error; }
  }));
  get("sign").addEventListener("click", () => track(async (current) => {
    if (!state || state.record || state.signed) return;
    if (!get("sign-confirm").checked) throw new Error("请先核对网络、收款、金额、手续费和找零，并勾选签名确认");
    if (now() < state.created || now() - state.created >= 120000) throw new Error("草稿已过期，请断开后重新配对");
    const signed = await sign(state.draft, lifetime.signal);
    if (current === generation) { state.signed = signed; get("send-confirm").checked = false; }
  }));
  get("send").addEventListener("click", () => track(async (current) => {
    if (!state?.signed || state.record) return;
    if (!get("send-confirm").checked) throw new Error("请再次勾选，明确确认向本地 simnet 广播此交易");
    if (now() < state.created || now() - state.created >= 120000) throw new Error("草稿已过期，请断开后重新配对");
    const active = state;
    const record = await active.broadcaster.submit({ draft: active.draft, signed: active.signed, confirmedTxid: active.signed.txid });
    if (current === generation) { active.record = record; active.signed = null; get("send-confirm").checked = false; }
  }));
  get("refresh").addEventListener("click", () => track(async (current) => {
    if (!state?.record) return;
    const active = state;
    const record = await active.broadcaster.refresh(active.record.txid);
    if (current === generation) active.record = record;
  }));
  get("disconnect").addEventListener("click", clear);
  document.defaultView.addEventListener("pagehide", clear);
  document.defaultView.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "visible") clear(); });
  render();
  return { idle: () => pending, clear };
}
