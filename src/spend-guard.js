import { err } from "./i18n.js";
// Pin outpoints after an unknown/broadcast submit so the shell cannot build a
// conflicting replacement until the journal settles or the user clears them.

const KEY = "prlSpendLocks";

function outpointId(txid, vout) {
  if (!/^[0-9a-f]{64}$/.test(txid) || !Number.isInteger(vout) || vout < 0) {
    throw err("err.spend.lockIdInvalid");
  }
  return `${txid}:${vout}`;
}

export function createSpendGuard({ storage, now = Date.now } = {}) {
  async function read() {
    if (!storage?.getSpendLocks) return [];
    const got = await storage.getSpendLocks();
    if (!Array.isArray(got)) return [];
    return got.filter((item) => item && typeof item.id === "string" && /^[0-9a-f]{64}:\d+$/.test(item.id));
  }
  async function write(list) {
    if (!storage?.setSpendLocks) return;
    await storage.setSpendLocks(list);
  }
  return {
    async pin(inputs, { txid, status } = {}) {
      if (!Array.isArray(inputs) || !inputs.length) return;
      const existing = await read();
      const byId = new Map(existing.map((item) => [item.id, item]));
      const stamped = now();
      for (const input of inputs) {
        const id = outpointId(input.txid, input.vout);
        byId.set(id, { id, txid: txid || null, status: status || "unknown", at: stamped });
      }
      await write([...byId.values()]);
    },
    async releaseTxid(txid) {
      if (!/^[0-9a-f]{64}$/.test(txid)) return;
      const next = (await read()).filter((item) => item.txid !== txid);
      await write(next);
    },
    async releaseAll() {
      await write([]);
    },
    async assertAvailable(inputs) {
      const locked = new Set((await read()).map((item) => item.id));
      for (const input of inputs) {
        const id = outpointId(input.txid, input.vout);
        if (locked.has(id)) {
          throw err("err.spend.pendingConflict");
        }
      }
    },
    async list() {
      return read();
    },
  };
}

export { KEY as SPEND_LOCKS_KEY };
