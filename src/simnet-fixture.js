import fixture from "./pearl-v1.5.5.json" with { type: "json" };
import { deriveAddress } from "./keys.js";
import { buildDraft, fromHex, validateDraft } from "./transaction.js";
import { createVault } from "./vault.js";

export function validateSimnetFixture(value) {
  const draft = validateDraft(value);
  const seed = fromHex(fixture.seedHex);
  try {
    if (draft.network !== "Pearl simnet" || draft.sourcePath.branch !== 0 || draft.sourcePath.index !== 0
      || draft.changeIndex !== 0 || draft.amount !== "1" || draft.feeRate !== 2 || draft.maxFee !== "0.01"
      || draft.sourceAddress !== deriveAddress(seed, 0, 0, draft.network)
      || draft.destination !== deriveAddress(seed, 0, 1, draft.network)
      || draft.changeAddress !== deriveAddress(seed, 1, 0, draft.network)) throw new Error("桥接草稿不属于固定公开 simnet 夹具");
    return buildDraft(draft);
  } finally { seed.fill(0); }
}

export async function signSimnetFixture(draft, signal) {
  validateSimnetFixture(draft);
  let encrypted;
  const vault = createVault({ network: "Pearl simnet",
    storage: { async getVault() { return encrypted; }, async setVault(value) { encrypted = value; } },
    locks: { request(_name, _options, work) { return work(); } } });
  const abort = () => vault.lock();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await vault.init();
    if (signal?.aborted) throw new Error("签名已取消");
    const password = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, "0")).join("");
    await vault.save("hex", fixture.seedHex, password);
    if (signal?.aborted) throw new Error("签名已取消");
    return vault.signTransaction(draft);
  } finally { vault.lock(); encrypted = null; signal?.removeEventListener("abort", abort); }
}
