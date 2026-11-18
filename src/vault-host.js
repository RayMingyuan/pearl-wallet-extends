import { err, packMessage } from "./i18n.js";
import { createVault } from "./vault.js";

function publicDirectory(directory) {
  return {
    schemaVersion: directory.schemaVersion,
    accounts: (directory.accounts || []).map((account) => ({
      id: account.id,
      name: account.name,
      account: account.account,
      address: account.address,
      receiveNext: account.receiveNext,
      changeNext: account.changeNext,
      receiveDescriptor: account.receiveDescriptor,
      changeDescriptor: account.changeDescriptor,
      gapLimit: account.gapLimit,
    })),
    watch: directory.watch || [],
  };
}

export function createVaultSession({ idleMs, network } = {}) {
  let record = null;
  let dirty = false;
  const storage = {
    async getVault() { return record ? structuredClone(record) : null; },
    async setVault(value) { record = structuredClone(value); dirty = true; },
    async removeVault() { record = null; dirty = true; },
  };
  const locks = { request(_name, _options, work) { return work(); } };
  const vault = createVault({ storage, locks, idleMs, network });
  return {
    vault,
    replaceRecord(next) {
      record = next ? structuredClone(next) : null;
      dirty = false;
    },
    consume() {
      if (!dirty) return { changed: false };
      dirty = false;
      return { changed: true, record: record ? structuredClone(record) : null };
    },
  };
}

export async function dispatchVault(session, message) {
  const { vault } = session;
  try {
    if (!vault.status.unlocked) {
      if (message && Object.prototype.hasOwnProperty.call(message, "record")) session.replaceRecord(message.record);
      await vault.init();
    }
    let result = null;
    const op = message?.op;
    if (op === "init") result = null;
    else if (op === "switchNetwork") {
      if (message.network) vault.switchNetwork(message.network);
      result = null;
    }
    else if (op === "unlock") await vault.unlock(message.password);
    else if (op === "verifyPassword") await vault.verifyPassword(message.password);
    else if (op === "lock") vault.lock();
    else if (op === "save") await vault.save(message.kind, message.value, message.password, message.book ?? null);
    else if (op === "address") result = vault.address(message.branch ?? 0, message.index ?? 0, message.account ?? 0);
    else if (op === "describe") result = vault.describe(message.account ?? 0);
    else if (op === "directory") result = publicDirectory(vault.directory());
    else if (op === "projectedBook") result = vault.projectedBook(message.current ?? null);
    else if (op === "noteBook") await vault.noteBook(message.book, message.password);
    else if (op === "commitBook") await vault.commitBook(message.password, message.book);
    else if (op === "addPrivateKey") result = await vault.addPrivateKey(message.password, message.key, message.id);
    else if (op === "changePassword") await vault.changePassword(message.current, message.nextPassword);
    else if (op === "remove") {
      await vault.verifyPassword(message.password);
      await vault.remove();
    } else if (op === "signTransaction") {
      await vault.verifyPassword(message.password);
      result = vault.signTransaction(message.draft);
    } else if (op === "mnemonic") {
      await vault.verifyPassword(message.password);
      result = vault.mnemonic();
    }
    else if (op === "importedKeys") result = vault.importedKeys();
    else throw err("err.vault.unknownOperation");
    return { ok: true, status: vault.status, result, stored: session.consume() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : packMessage("err.vault.operationFailed"),
      status: vault.status,
      stored: session.consume(),
    };
  }
}
