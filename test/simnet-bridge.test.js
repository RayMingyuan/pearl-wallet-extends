import assert from "node:assert/strict";
import test from "node:test";
import { request as httpRequest } from "node:http";
import { startSimnetBridge } from "../scripts/simnet-bridge.js";
import { simnetDraft as draft, simnetSigned as signed } from "./simnet-helpers.js";

async function bridgeHarness(t, options = {}) {
  let sends = 0; let mined = 0;
  const bridge = await startSimnetBridge({ draft, port: 0, rpc: {
    async assertChain() {}, async preflight() { return true; },
    async send() { sends += 1; if (options.send) return options.send(); return signed.txid; },
    async lookup() { return options.lookup ? options.lookup() : { txid: signed.txid, confirmations: 1 }; },
    async call(method) { assert.equal(method, "generate"); mined += 1; },
  } });
  t.after(() => bridge.close());
  async function request(path, body, headers = {}) {
    return fetch(`${bridge.url}/${path}`, { method: body ? "POST" : "GET", headers: {
      Origin: `chrome-extension://${"a".repeat(32)}`, Authorization: `Bearer ${bridge.token}`,
      ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify({ session: bridge.id, ...body }) : undefined });
  }
  return { bridge, request, get sends() { return sends; }, get mined() { return mined; } };
}

test("bridge requires extension origin, correct pairing and current session", async (t) => {
  const h = await bridgeHarness(t);
  assert.equal((await h.request("session", null, { Origin: "http://example.com" })).status, 403);
  assert.equal((await h.request("session", null, { Authorization: "Bearer invalid" })).status, 401);
  const wrongHost = await new Promise((done, reject) => {
    const request = httpRequest(`${h.bridge.url}/session`, { headers: { Host: "example.com", Origin: `chrome-extension://${"a".repeat(32)}` } },
      (response) => { response.resume(); done(response.statusCode); });
    request.on("error", reject); request.end();
  });
  assert.equal(wrongHost, 403);
  const response = await h.request("session"); const session = await response.json();
  assert.equal(session.network, "Pearl simnet"); assert.equal(session.id, h.bridge.id);
  assert.equal("token" in session, false); assert.equal("authorization" in session, false);
  assert.equal((await h.request("send", { rawHex: signed.rawHex, session: "old" })).status, 409);
  assert.equal((await h.request("arbitrary-rpc", { method: "stop" })).status, 404);
  assert.equal(h.sends, 0);
});

test("bridge rejects altered transactions and serializes duplicate requests", async (t) => {
  const h = await bridgeHarness(t);
  assert.equal((await h.request("send", { rawHex: signed.rawHex.slice(0, -2) })).status, 502);
  assert.equal(h.sends, 0);
  assert.deepEqual(await (await h.request("preflight", { rawHex: signed.rawHex })).json(), { accepted: true });
  const results = await Promise.all([h.request("send", { rawHex: signed.rawHex }), h.request("send", { rawHex: signed.rawHex })]);
  for (const result of results) assert.equal((await result.json()).txid, signed.txid);
  assert.equal(h.sends, 1); assert.equal(h.bridge.sends, 1); assert.equal(h.mined, 1);
  assert.equal((await (await h.request("lookup", { txid: signed.txid })).json()).found.confirmations, 1);
  assert.equal((await h.request("lookup", { txid: "00".repeat(32) })).status, 400);
});

test("server never sends twice after an ambiguous RPC failure", async (t) => {
  let found = false;
  const h = await bridgeHarness(t, { send() { throw new Error("response lost"); }, lookup() { return found ? { txid: signed.txid, confirmations: 0 } : null; } });
  assert.equal((await h.request("send", { rawHex: signed.rawHex })).status, 502);
  assert.equal((await h.request("send", { rawHex: signed.rawHex })).status, 409);
  assert.equal(h.sends, 1);
  found = true;
  assert.equal((await (await h.request("send", { rawHex: signed.rawHex })).json()).txid, signed.txid);
  assert.equal(h.sends, 1);
});
