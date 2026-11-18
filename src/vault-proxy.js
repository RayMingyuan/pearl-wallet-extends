import { err } from "./i18n.js";
export function createVaultProxy({ send, idleMs = 5 * 60 * 1000, network = "Pearl mainnet", onLock } = {}) {
  if (typeof send !== "function") {
    send = (message) => globalThis.chrome.runtime.sendMessage(message);
  }
  let status = { exists: false, ready: false, busy: false, unlocked: false };
  let activeNetwork = network;
  const listeners = new Set();
  const runtime = globalThis.chrome?.runtime;
  if (runtime?.onMessage?.addListener) {
    runtime.onMessage.addListener((message) => {
      if (message?.target !== "vault-lock") return;
      status = { ...status, unlocked: false };
      for (const listener of listeners) listener("lock");
      onLock?.();
    });
  }
  async function call(op, extra = {}) {
    const response = await send({ target: "vault", op, idleMs, network: activeNetwork, ...extra });
    if (response?.status) status = response.status;
    if (!response?.ok) {
      if (response?.error) throw new Error(response.error);
      throw err("err.vault.unavailable");
    }
    return response.result ?? null;
  }
  return {
    get status() { return status; },
    get network() { return activeNetwork; },
    async setNetwork(next) {
      if (typeof next !== "string" || !next) throw err("err.network.invalid");
      if (next === activeNetwork) return;
      activeNetwork = next;
      await call("switchNetwork");
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    init() { return call("init"); },
    unlock(password) { return call("unlock", { password }); },
    verifyPassword(password) { return call("verifyPassword", { password }); },
    lock() { status = { ...status, unlocked: false }; return call("lock"); },
    save(kind, value, password, book = null) { return call("save", { kind, value, password, book }); },
    address(branch = 0, index = 0, account = 0) { return call("address", { branch, index, account }); },
    describe(account = 0) { return call("describe", { account }); },
    directory() { return call("directory"); },
    projectedBook(current = null) { return call("projectedBook", { current }); },
    noteBook(book, password) { return call("noteBook", { book, password }); },
    commitBook(password, book) { return call("commitBook", { password, book }); },
    addPrivateKey(password, key, id) { return call("addPrivateKey", { password, key, id }); },
    changePassword(current, nextPassword) { return call("changePassword", { current, nextPassword }); },
    remove(password) { return call("remove", { password }); },
    signTransaction(draft, password) { return call("signTransaction", { draft, password }); },
    mnemonic(password) { return call("mnemonic", { password }); },
    importedKeys() { return call("importedKeys"); },
  };
}
