import assert from "node:assert/strict";
import test from "node:test";
import { createLocalRpc, LOCAL_GENESIS } from "../scripts/local-rpc.js";

function rpcHarness(resultFor) {
  const calls = [];
  const rpc = createLocalRpc({ network: "Pearl simnet", url: "http://127.0.0.1:18334/", authorization: "Basic public-test-only",
    async fetchImpl(url, options) {
      assert.equal(url, "http://127.0.0.1:18334/"); assert.equal(options.redirect, "error");
      const request = JSON.parse(options.body); calls.push(request);
      let result = request.method === "getblockchaininfo" ? { chain: "simnet" } : LOCAL_GENESIS;
      if (resultFor) result = resultFor(request, result);
      return { ok: true, async text() { return JSON.stringify({ id: request.id, result, error: null }); } };
    } });
  return { rpc, calls };
}

test("local RPC refuses remote hosts, credentials in URL and mainnet", () => {
  for (const url of ["http://localhost:18334/", "https://127.0.0.1:18334/", "http://example.com:18334/", "http://127.0.0.1:18334/path", "http://a:b@127.0.0.1:18334/", "http://127.0.0.1:18334/?x=1"]) {
    assert.throws(() => createLocalRpc({ network: "Pearl simnet", url }), /loopback/);
  }
  assert.throws(() => createLocalRpc({ network: "Pearl mainnet", url: "http://127.0.0.1:18334/" }), /loopback/);
});

test("wrong chain or genesis stops before sending, even when HRP is shared", async () => {
  for (const wrong of ["chain", "genesis"]) {
    const h = rpcHarness((req, result) => wrong === "chain" && req.method === "getblockchaininfo" ? { chain: "regtest" }
      : wrong === "genesis" && req.method === "getblockhash" ? "00".repeat(32) : result);
    await assert.rejects(() => h.rpc.send("test-hex"), /genesis/);
    assert.equal(h.calls.some((req) => req.method === "sendrawtransaction"), false);
  }
});

test("official preflight needs explicit maxfeerate and can omit false allowed", async () => {
  for (const result of [[{ allowed: true }], [{ "reject-reason": "missing-inputs" }], [{ allowed: false, "reject-reason": "rejected" }]]) {
    const h = rpcHarness((req, fallback) => req.method === "testmempoolaccept" ? result : fallback);
    assert.equal(await h.rpc.preflight("test-hex"), result[0].allowed === true);
    assert.deepEqual(h.calls.at(-1).params, [["test-hex"], 0.1]);
  }
  const h = rpcHarness((req, fallback) => req.method === "testmempoolaccept" ? [{}] : fallback);
  await assert.rejects(() => h.rpc.preflight("test-hex"), /invalid/);
});

test("lookup treats official RPC -5 as absent", async () => {
  const rpc = createLocalRpc({ network: "Pearl simnet", url: "http://127.0.0.1:18334/", authorization: "Basic public-test-only",
    async fetchImpl(_url, options) {
      const request = JSON.parse(options.body);
      const absent = request.method === "getrawtransaction";
      return { ok: !absent, status: absent ? 500 : 200, async text() { return JSON.stringify({ id: request.id,
        result: request.method === "getblockchaininfo" ? { chain: "simnet" } : LOCAL_GENESIS,
        error: absent ? { code: -5, message: "not logged" } : null }); } };
    } });
  assert.equal(await rpc.lookup("11".repeat(32)), null);
});
