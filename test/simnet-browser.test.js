import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseHTML } from "linkedom";
import { createSimnetClient, SIMNET_BRIDGE_ORIGIN } from "../src/simnet-client.js";
import { createSimnetStore } from "../src/simnet-storage.js";
import { signSimnetFixture, validateSimnetFixture } from "../src/simnet-fixture.js";
import { mountSimnet } from "../src/simnet-ui.js";
import { buildDraft } from "../src/transaction.js";
import { memorySimnetArea, serialSimnetLocks, simnetDraft as draft, simnetSigned as signed, simnetSession as id, simnetPairing as token } from "./simnet-helpers.js";

function harness(t, options = {}) {
  const { document } = parseHTML(readFileSync(new URL("../src/simnet.html", import.meta.url), "utf8"));
  const area = options.area || memorySimnetArea();
  let sends = 0; let lookups = 0; let closed = 0;
  const ui = mountSimnet(document, { locks: options.locks || serialSimnetLocks(), now: options.now,
    createStore: (session) => createSimnetStore(session, area),
    sign: options.sign || (async () => signed),
    createClient(value) {
      assert.equal(value, token);
      return { async connect() { return options.connect ? options.connect() : { id, network: "Pearl simnet", draft }; },
        async preflight() { return true; }, async send() { sends += 1; return options.send ? options.send() : signed.txid; },
        async lookup() { lookups += 1; return options.lookup ? options.lookup() : { txid: signed.txid, confirmations: 1 }; },
        close() { closed += 1; } };
    } });
  const get = (suffix) => document.getElementById(`simnet-${suffix}`);
  const click = (suffix) => get(suffix).dispatchEvent(new document.defaultView.Event("click", { bubbles: true }));
  const connect = async () => { get("pair").value = token; click("connect"); await ui.idle(); };
  const sign = async () => { get("sign-confirm").checked = true; click("sign"); await ui.idle(); };
  const send = async () => { get("send-confirm").checked = true; click("send"); await ui.idle(); };
  t.after(() => ui.clear());
  return { ui, get, click, connect, sign, send, area, document, get sends() { return sends; }, get lookups() { return lookups; }, get closed() { return closed; } };
}

test("simnet UI requires separate signing and broadcast confirmations and only journals public status", async (t) => {
  const h = harness(t);
  await h.connect();
  assert.equal(h.get("pair").value, "");
  assert.match(h.get("summary").textContent, /Pearl simnet/);
  assert.match(h.get("summary").textContent, /金额：1 PEARL/);
  for (const address of [draft.sourceAddress, draft.destination, draft.changeAddress]) assert.ok(h.get("summary").textContent.includes(address));
  h.click("sign"); await h.ui.idle(); assert.match(h.get("error").textContent, /签名确认/);
  h.get("send-confirm").checked = true;
  await h.sign(); assert.match(h.get("status").textContent, /已签名，尚未广播/);
  assert.equal(h.get("send-confirm").checked, false, "签名前的勾选不能替代签名后的广播确认");
  h.click("send"); await h.ui.idle(); assert.match(h.get("error").textContent, /再次勾选/);
  assert.equal(h.sends, 0);
  await h.send(); assert.equal(h.sends, 1); assert.match(h.get("status").textContent, /已广播/);
  await h.send(); assert.equal(h.sends, 1);
  const stored = JSON.stringify(h.area.mem);
  for (const forbidden of [token, signed.rawHex, "seedHex", "password", "pearlVault", "prlWatchAddress"]) assert.equal(stored.includes(forbidden), false);
  assert.deepEqual(Object.keys(Object.values(h.area.mem)[0]).sort(), ["confirmations", "network", "status", "txid"]);
});

test("unknown persists across reopening, permits lookup, and never enables another send", async (t) => {
  const area = memorySimnetArea();
  const first = harness(t, { area, send() { throw new Error("response lost"); } });
  await first.connect(); await first.sign(); await first.send();
  assert.match(first.get("status").textContent, /状态未知/);
  first.ui.clear();
  const reopened = harness(t, { area }); await reopened.connect();
  assert.match(reopened.get("status").textContent, /状态未知/);
  assert.equal(reopened.get("send").disabled, true); assert.equal(reopened.get("sign").disabled, true);
  reopened.click("refresh"); await reopened.ui.idle();
  assert.match(reopened.get("status").textContent, /确认数：1/);
  assert.equal(first.sends, 1); assert.equal(reopened.sends, 0); assert.equal(reopened.lookups, 1);
});

test("two pages sharing Web Locks and journal submit the transaction once", async (t) => {
  const area = memorySimnetArea(); const locks = serialSimnetLocks();
  const a = harness(t, { area, locks }); const b = harness(t, { area, locks });
  await Promise.all([a.connect(), b.connect()]); await Promise.all([a.sign(), b.sign()]);
  await Promise.all([a.send(), b.send()]); assert.equal(a.sends + b.sends, 1);
});

test("expiry and page lifecycle clear signatures and discard late signing results", async (t) => {
  let now = 1000; let complete;
  const h = harness(t, { now: () => now, sign() { return new Promise((done) => { complete = done; }); } });
  await h.connect(); now += 120000;
  await h.sign(); assert.match(h.get("error").textContent, /过期/);
  h.ui.clear(); await h.connect();
  h.get("sign-confirm").checked = true; h.click("sign");
  await Promise.resolve(); await Promise.resolve();
  h.document.defaultView.dispatchEvent(new h.document.defaultView.Event("pagehide"));
  complete(signed); await h.ui.idle();
  assert.equal(h.get("review").hidden, true); assert.equal(h.get("summary").textContent, "");
  assert.equal(h.get("send").disabled, true); assert.equal(h.get("pair").value, ""); assert.equal(h.sends, 0);
});

test("corrupt storage and unavailable Web Locks fail before signing or sending", async (t) => {
  const area = memorySimnetArea();
  area.mem[`prlSimnetJournal:${id}`] = { status: "unknown" };
  const h = harness(t, { area }); await h.connect();
  assert.match(h.get("error").textContent, /损坏/); assert.equal(h.get("review").hidden, true);
  const noLocks = harness(t, { locks: {} }); await noLocks.connect();
  assert.match(noLocks.get("error").textContent, /Web Locks/); assert.equal(noLocks.sends, 0);
});

test("fixed public signer rejects other parameters and cancels before signing", async () => {
  assert.deepEqual(validateSimnetFixture(draft), draft);
  assert.throws(() => validateSimnetFixture(buildDraft({ ...draft, amount: "0.5" })), /固定公开/);
  const signal = AbortSignal.abort();
  await assert.rejects(() => signSimnetFixture(draft, signal), /取消/);
  const controller = new AbortController();
  const signing = signSimnetFixture(draft, controller.signal);
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(() => signing, /cancelledRetry/);
  assert.equal((await signSimnetFixture(draft)).txid, signed.txid);
});

test("client sends pairing only in headers to fixed loopback and aborts on close", async () => {
  const calls = [];
  const client = createSimnetClient(token, { async fetchImpl(url, options) {
    calls.push({ url, options });
    return { ok: true, async text() { return JSON.stringify(url.endsWith("/session") ? { id, network: "Pearl simnet", draft } : { accepted: true }); } };
  } });
  await client.connect(); await client.preflight(signed.rawHex);
  assert.equal(calls[0].url, `${SIMNET_BRIDGE_ORIGIN}/session`);
  for (const call of calls) { assert.equal(call.options.headers.Authorization, `Bearer ${token}`); assert.equal(call.url.includes(token), false); assert.equal(call.options.redirect, "error"); }
  assert.equal(JSON.parse(calls[1].options.body).session, id);
  client.close(); assert.equal(calls[0].options.signal.aborted, false);
  await assert.rejects(() => client.lookup(signed.txid), /断开/);
  assert.throws(() => createSimnetClient("invalid"), /配对码/);
  let inFlight;
  const pendingClient = createSimnetClient(token, { fetchImpl(_url, options) {
    inFlight = options.signal;
    return new Promise((_done, reject) => { options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }); });
  } });
  const connecting = pendingClient.connect();
  pendingClient.close(); assert.equal(inFlight.aborted, true);
  await assert.rejects(() => connecting, /cancelled/);
});

test("journal isolates sessions and rejects malformed data and hung storage", async () => {
  const area = memorySimnetArea();
  const store = createSimnetStore(id, area);
  const record = { network: "Pearl simnet", txid: signed.txid, status: "unknown", confirmations: 0 };
  await store.put(`simnet:${signed.txid}`, record);
  assert.deepEqual(await store.read(), record);
  assert.equal(await createSimnetStore("cc".repeat(16), area).read(), null);
  await assert.rejects(() => store.put("wrong-key", record), /键不匹配/);
  await assert.rejects(() => store.put(`simnet:${signed.txid}`, { ...record, rawHex: signed.rawHex }), /损坏/);
  const hung = createSimnetStore(id, { get() {} }, 10);
  await assert.rejects(() => hung.read(), /noResponse/);
});

test("both built packages have separate permissions and classic scripts", () => {
  const normal = JSON.parse(readFileSync("dist/manifest.json"));
  const local = JSON.parse(readFileSync("dist-simnet/manifest.json"));
  assert.deepEqual(normal.host_permissions, [
    "https://blockbook.pearlresearch.ai/*",
    "https://blockbook.testnet.pearlresearch.ai/*",
    "https://blockbook.testnet2.pearlnetwork.net/*",
    "https://api.coinbase.com/*",
    "https://api.exchange.coinbase.com/*",
    "https://api.coingecko.com/*",
  ]);
  assert.deepEqual(local.host_permissions, ["http://127.0.0.1/*"]);
  assert.deepEqual(local.permissions, ["storage"]);
  assert.match(local.content_security_policy.extension_pages, /connect-src http:\/\/127\.0\.0\.1:18765/);
  assert.equal(local.action.default_popup, "simnet.html");
  const js = readFileSync("dist-simnet/simnet.js", "utf8");
  // Shared privacy copy names the default indexer. The simnet script must not embed that host as a URL.
  assert.equal(js.includes("https://blockbook.pearlresearch.ai"), false);
  assert.equal(js.includes("rpcpass"), false);
  assert.equal(readFileSync("dist/popup.js", "utf8").includes("prlSimnetJournal"), false);
  assert.match(readFileSync("dist-simnet/simnet.html", "utf8"), /src="simnet.js"/);
});
