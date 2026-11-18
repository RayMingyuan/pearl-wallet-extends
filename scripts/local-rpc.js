import { getNetwork } from "../src/networks.js";

export const LOCAL_GENESIS = "78d0ab27df6a51a8e9dbbdefffca1ebbbeb3818cb083ce2c2f43b047247e5832";

// Do not resolve an arbitrary hostname and do not follow redirects. Credentials stay inside the Node test process.
export function createLocalRpc({ network, url, authorization, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  const params = getNetwork(network);
  const target = new URL(url);
  if (!["regtest", "simnet"].includes(params.chain) || target.protocol !== "http:"
    || target.hostname !== "127.0.0.1" || !target.port || target.pathname !== "/"
    || target.search || target.hash || target.username || target.password) throw new Error("RPC is limited to the loopback address of an isolated local test chain");
  let sequence = 0;
  async function call(method, args = []) {
    const id = ++sequence;
    const response = await fetchImpl(target.href, { method: "POST", redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body: JSON.stringify({ jsonrpc: "1.0", id, method, params: args }), signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    if (text.length > 2000000) throw new Error("Local RPC response is too large");
    const body = JSON.parse(text);
    if (body.id !== id) throw new Error("Local RPC response id does not match");
    if (body.error) {
      const error = new Error(`Local node rejected the RPC request (${Number(body.error.code)})`);
      error.code = body.error.code;
      throw error;
    }
    if (!response.ok) throw new Error(`Local RPC HTTP ${response.status}`);
    return body.result;
  }
  async function assertChain() {
    const info = await call("getblockchaininfo");
    if (info?.chain !== params.chain || await call("getblockhash", [0]) !== LOCAL_GENESIS) {
      throw new Error("Local node chain or genesis does not match");
    }
  }
  return {
    call,
    assertChain,
    async preflight(rawHex) {
      await assertChain();
      const result = await call("testmempoolaccept", [[rawHex], 0.1]);
      if (!Array.isArray(result) || result.length !== 1) throw new Error("Preflight response is invalid");
      if (result[0]?.allowed === true) return true;
      // The official bool uses omitempty, so false is omitted. Treat it as a failure only when an explicit rejection reason is present.
      if ((result[0]?.allowed === false || result[0]?.allowed === undefined)
        && typeof result[0]?.["reject-reason"] === "string" && result[0]["reject-reason"]) return false;
      throw new Error("Preflight response is invalid");
    },
    async send(rawHex) {
      await assertChain();
      return call("sendrawtransaction", [rawHex]);
    },
    async lookup(txid) {
      await assertChain();
      try { return await call("getrawtransaction", [txid, 1]); }
      catch (error) { if (error.code === -5) return null; throw error; }
    },
  };
}
