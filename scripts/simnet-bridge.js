import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { decodeTransaction, verifySignedTransaction } from "../src/transaction.js";

// Expose only the fixed fixture this process already built. Do not proxy arbitrary RPC and do not accept an outside transaction output.
export async function startSimnetBridge({ rpc, draft, port = 18765 }) {
  if (draft.network !== "Pearl simnet") throw new Error("Bridge allows simnet only");
  await rpc.assertChain();
  const id = randomBytes(16).toString("hex");
  const token = randomBytes(32).toString("hex");
  const txid = decodeTransaction(draft.unsignedHex).txid;
  let attempted = false;
  let sends = 0;
  let serial = Promise.resolve();
  const server = createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expectedHost || !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin || "")) return json(403, { error: "origin" });
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        if (req.headers["access-control-request-private-network"] === "true") res.setHeader("Access-Control-Allow-Private-Network", "true");
        res.writeHead(204); return res.end();
      }
      const supplied = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (!/^[0-9a-f]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return json(401, { error: "pairing" });
      if (req.method === "GET" && req.url === "/session") return json(200, { id, network: "Pearl simnet", draft });
      if (req.method !== "POST" || !["/preflight", "/send", "/lookup"].includes(req.url)) return json(404, { error: "route" });
      if (req.headers["content-type"] !== "application/json") return json(415, { error: "content-type" });
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1000000) return json(413, { error: "size" });
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body.session !== id) return json(409, { error: "session" });
      if (req.url === "/lookup") {
        if (body.txid !== txid) return json(400, { error: "transaction" });
        const found = await rpc.lookup(txid);
        return json(200, { found: found ? { txid: found.txid, confirmations: found.confirmations || 0 } : null });
      }
      const transaction = verifySignedTransaction(draft, { rawHex: body.rawHex, txid, vsize: draft.vsize, fee: draft.fee });
      if (req.url === "/preflight") return json(200, { accepted: await rpc.preflight(transaction.rawHex) });
      // The server also allows only one send, so different extension origins or stores cannot submit it twice.
      const work = serial.then(async () => {
        if (attempted) {
          const found = await rpc.lookup(txid);
          if (found?.txid === txid) return json(200, { txid });
          return json(409, { error: "unknown" });
        }
        if (!await rpc.preflight(transaction.rawHex)) return json(409, { error: "preflight" });
        attempted = true; sends += 1;
        const returned = await rpc.send(transaction.rawHex);
        if (returned !== txid) return json(502, { error: "unknown" });
        try { await rpc.call("generate", [1]); } catch { /* Acceptance evidence still stands. A failed mine can be checked later. */ }
        return json(200, { txid });
      });
      serial = work.catch(() => {});
      await work;
    } catch { if (!res.headersSent) json(502, { error: "bridge" }); else res.end(); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise((done, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", done); });
  return { id, token, url: `http://127.0.0.1:${server.address().port}`, get sends() { return sends; },
    async close() { await new Promise((done) => { server.close(done); server.closeAllConnections(); }); await serial; } };
}
