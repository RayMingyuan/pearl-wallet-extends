import assert from "node:assert/strict";
import test from "node:test";
import {
  BlockbookBroadcastError,
  createBlockbookBroadcastTransport,
  lookupTransaction,
  sendRawTransaction,
} from "../src/blockbook-broadcast.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

const txid = "ab".repeat(32);

test("sendtx uses text payload and accepts txid in plain text or JSON", async () => {
  for (const body of [txid, { result: txid }, { txid }]) {
    let captured;
    const sent = await sendRawTransaction("00ff", {
      origin: "https://example.test",
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return jsonResponse(200, body);
      },
    });
    assert.equal(sent, txid);
    assert.equal(captured.url, "https://example.test/api/v2/sendtx/");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.body, "00ff");
    assert.equal(captured.options.headers.Accept, "application/json");
    assert.equal(captured.options.headers["Content-Type"], "text/plain;charset=UTF-8");
  }
});

test("sendtx rejects malformed hex, network failures and invalid response shape", async () => {
  await assert.rejects(() => sendRawTransaction("{}"), /hexInvalid/);
  await assert.rejects(
    () => sendRawTransaction("00", { fetchImpl: async () => { throw new Error("offline"); } }),
    (error) => error instanceof BlockbookBroadcastError && error.kind === "network",
  );
  await assert.rejects(
    () => sendRawTransaction("00", { fetchImpl: async () => jsonResponse(200, { ok: true }) }),
    (error) => error instanceof BlockbookBroadcastError && error.kind === "shape",
  );
});

test("sendtx returns backend rejection details", async () => {
  await assert.rejects(
    () => sendRawTransaction("00", { fetchImpl: async () => jsonResponse(400, { error: "-22: TX decode failed" }) }),
    (error) => error instanceof BlockbookBroadcastError
      && error.kind === "rejected"
      && error.status === 400
      && error.message === "索引节点拒绝了这笔交易"
      && error.message.includes("-22") === false,
  );
});

test("lookup returns confirmations, maps tx-not-found to null, and rejects malformed shapes", async () => {
  let captured;
  const found = await lookupTransaction(txid, {
    origin: "https://example.test",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return jsonResponse(200, { txid, confirmations: 2 });
    },
  });
  assert.deepEqual(found, { txid, confirmations: 2 });
  assert.equal(captured.url, `https://example.test/api/v2/tx/${txid}`);
  assert.equal(captured.options.method, "GET");
  assert.equal(captured.options.headers.Accept, "application/json");

  const missing = await lookupTransaction(txid, {
    fetchImpl: async () => jsonResponse(400, { error: `Transaction '${txid}' not found` }),
  });
  assert.equal(missing, null);

  await assert.rejects(
    () => lookupTransaction(txid, { fetchImpl: async () => jsonResponse(200, { txid, confirmations: "2" }) }),
    (error) => error instanceof BlockbookBroadcastError && error.kind === "shape",
  );
});

test("lookup throws for non-notfound client errors and network failures", async () => {
  await assert.rejects(
    () => lookupTransaction(txid, { fetchImpl: async () => jsonResponse(400, { error: "bad request" }) }),
    (error) => error instanceof BlockbookBroadcastError
      && error.kind === "rejected"
      && error.status === 400,
  );
  await assert.rejects(
    () => lookupTransaction(txid, { fetchImpl: async () => { throw new Error("socket"); } }),
    (error) => error instanceof BlockbookBroadcastError && error.kind === "network",
  );
});

test("transport preflight only validates hex and does not invent a remote precheck", async () => {
  const transport = createBlockbookBroadcastTransport({
    fetchImpl: async () => jsonResponse(200, txid),
  });
  await assert.rejects(() => transport.preflight("zz"), /hexInvalid/);
  assert.equal(await transport.preflight("00"), true);
});
