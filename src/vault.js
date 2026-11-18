import { err } from "./i18n.js";
import { addressFromPrivateKey, deriveAddress, describeAccount, normalizePrivateKey, normalizeSecret, secretToSeed, signTaprootHashes } from "./keys.js";
import { finalizeTransaction, signatureHashes, validateDraft } from "./transaction.js";
import { getNetwork } from "./networks.js";
import { buildDirectory, projectAccounts, secretFromDirectory } from "./vault-directory.js";
import { isShortUniformPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-policy.js";
import { encode, ITERATIONS, validateVaultRecord } from "./vault-record.js";

export { VAULT_KEY, validateVaultRecord } from "./vault-record.js";
export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-policy.js";
export const IDLE_MS = 5 * 60 * 1000;
const aad = new TextEncoder().encode("Pearl Pocket vault v2");

function checkPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw err("err.vault.passwordWrongInput");
  }
}

function checkNewPassword(password) {
  checkPassword(password);
  if (isShortUniformPassword(password)) throw err("err.vault.passwordUniformShort");
}

function watchRows(directory) {
  return directory?.watch || [];
}

function watchRewritten(previous, next) {
  const before = new Map(watchRows(previous).map((item) => [item.id, item.address]));
  return watchRows(next).some((item) => !before.has(item.id) || before.get(item.id) !== item.address);
}

async function passwordKey(crypto, password, salt, usage) {
  checkPassword(password);
  const encoded = new TextEncoder().encode(password);
  try {
    const material = await crypto.subtle.importKey("raw", encoded, "PBKDF2", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
      material, { name: "AES-GCM", length: 256 }, false, [usage]);
  } finally { encoded.fill(0); }
}

async function passwordKeys(crypto, password, salt) {
  checkPassword(password);
  const encoded = new TextEncoder().encode(password);
  let bits;
  try {
    const material = await crypto.subtle.importKey("raw", encoded, "PBKDF2", false, ["deriveBits"]);
    bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, material, 256,
    ));
    const encryptKey = await crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt"]);
    const decryptKey = await crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["decrypt"]);
    return { encryptKey, decryptKey };
  } finally {
    encoded.fill(0);
    bits?.fill(0);
  }
}

export function createVault({ storage, crypto = globalThis.crypto, idleMs = IDLE_MS, now = Date.now,
  schedule = setTimeout, cancel = clearTimeout, locks = globalThis.navigator?.locks, network: initialNetwork = "Pearl mainnet" }) {
  let network = initialNetwork;
  getNetwork(network);
  let exists = false;
  let ready = false;
  let busy = false;
  let seed = null;
  let packed = null;
  let sealingKey = null;
  let timer;
  let deadline = 0;
  let generation = 0;
  let unlockedCiphertext = null;
  const listeners = new Set();
  const notify = (event) => { for (const listener of listeners) listener(event); };
  function lock() {
    generation += 1;
    cancel(timer);
    seed?.fill(0);
    seed = null;
    packed?.fill(0);
    packed = null;
    sealingKey = null;
    unlockedCiphertext = null;
    deadline = 0;
    notify("lock");
  }
  function touch() {
    if (!seed) return;
    if (now() >= deadline) { lock(); return; }
    deadline = now() + idleMs;
    cancel(timer);
    timer = schedule(lock, idleMs);
  }
  function installSeed(value, started) {
    // Locking, including when the page is hidden, must cancel an in-flight decrypt or KDF. It must not unlock again afterward.
    if (started !== generation) { value.fill(0); throw err("err.vault.cancelledReunlock"); }
    seed?.fill(0);
    seed = value;
    deadline = now() + idleMs;
    touch();
  }
  function publicDirectory(directory) {
    return JSON.stringify({
      accounts: (directory?.accounts || []).map((account) => ({
        id: account.id,
        name: account.name,
        account: account.account,
        receiveNext: account.receiveNext,
        changeNext: account.changeNext,
        receiveDescriptor: account.receiveDescriptor,
        changeDescriptor: account.changeDescriptor,
        gapLimit: account.gapLimit,
      })),
      watch: (directory?.watch || []).map((item) => ({ id: item.id, name: item.name, address: item.address })),
      imported: (directory?.keyrings || []).filter((item) => item.type === "imported").map((item) => item.id),
    });
  }
  async function resealWithSession(plaintext, started) {
    if (!sealingKey) throw err("err.vault.unlockRequired");
    const record = await storage.getVault();
    if (!record || record.ciphertext !== unlockedCiphertext) {
      lock();
      throw err("err.vault.changedElsewhere");
    }
    const newIv = crypto.getRandomValues(new Uint8Array(12));
    const nextCipher = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: newIv, additionalData: aad }, sealingKey, plaintext,
    ));
    if (started !== generation) throw err("err.vault.cancelledRetry");
    const next = { ...record, iv: encode(newIv), ciphertext: encode(nextCipher) };
    await storage.setVault(next);
    packed.fill(0);
    packed = plaintext.slice();
    unlockedCiphertext = next.ciphertext;
  }
  async function reseal(password, plaintext, started) {
    const record = await storage.getVault();
    const { salt, iv, ciphertext } = validateVaultRecord(record);
    try {
      const oldKey = await passwordKey(crypto, password, salt, "decrypt");
      await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, oldKey, ciphertext);
    } catch {
      throw err("err.vault.wrongPasswordNotWritten");
    }
    const newIv = crypto.getRandomValues(new Uint8Array(12));
    const aes = await passwordKey(crypto, password, salt, "encrypt");
    const nextCipher = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: newIv, additionalData: aad }, aes, plaintext,
    ));
    if (started !== generation) throw err("err.vault.cancelledRetry");
    const next = { ...record, iv: encode(newIv), ciphertext: encode(nextCipher) };
    await storage.setVault(next);
    packed.fill(0);
    packed = plaintext.slice();
    unlockedCiphertext = next.ciphertext;
    sealingKey = aes;
  }
  async function exclusive(work) {
    if (!ready) throw err("err.vault.notReady");
    if (busy) throw err("err.vault.busy");
    busy = true;
    notify();
    const started = generation;
    try { return await work(started); }
    finally { busy = false; notify(); }
  }
  // Web Locks serialize checks and writes across extension pages so two startup pages cannot overwrite each other's seed.
  function mutate(work) {
    if (!locks?.request) throw err("err.vault.noWebLocksModify");
    return locks.request("pearl-pocket-vault", { mode: "exclusive" }, work);
  }
  return {
    get status() { return { exists, ready, busy, unlocked: Boolean(seed) && now() < deadline }; },
    get network() { return network; },
    // A network switch is allowed while unlocked: only the derivation parameters change, not the seed. Mainnet and testnet addresses differ because their coin types differ.
    switchNetwork(next) {
      getNetwork(next);
      network = next;
      if (seed && now() < deadline) touch();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async init() {
      lock();
      const record = await storage.getVault();
      if (record != null) validateVaultRecord(record);
      exists = record != null;
      ready = true;
      notify();
    },
    async save(kind, value, password, book = null) {
      return exclusive((started) => mutate(async () => {
        if (exists || await storage.getVault() != null) throw err("err.vault.existsUnlockFirst");
        checkNewPassword(password);
        const secret = normalizeSecret(kind, value);
        let nextSeed = secretToSeed(secret);
        let plaintext;
        try {
          deriveAddress(nextSeed, 0, 0, network); // Confirm this build can derive before anything is written.
          const { directory } = buildDirectory({ secret, book, network });
          plaintext = new TextEncoder().encode(JSON.stringify(directory));
          const salt = crypto.getRandomValues(new Uint8Array(16));
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const key = await passwordKey(crypto, password, salt, "encrypt");
          const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plaintext));
          if (started !== generation) throw err("err.vault.cancelledRetry");
          const record = { version: 2, kdf: "PBKDF2-SHA256", iterations: ITERATIONS,
            salt: encode(salt), iv: encode(iv), ciphertext: encode(ciphertext) };
          await storage.setVault(record);
          exists = true;
          installSeed(nextSeed, started);
          packed?.fill(0);
          packed = plaintext.slice();
          unlockedCiphertext = record.ciphertext;
          sealingKey = key;
          nextSeed = null;
        } finally {
          nextSeed?.fill(0);
          plaintext?.fill(0);
        }
      }));
    },
    async unlock(password) {
      return exclusive(async (started) => {
        if (seed) throw err("err.vault.alreadyUnlocked");
        const record = await storage.getVault();
        const { salt, iv, ciphertext } = validateVaultRecord(record);
        const { encryptKey, decryptKey } = await passwordKeys(crypto, password, salt);
        let plaintext;
        let packedCopy;
        let nextSeed;
        try {
          plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, decryptKey, ciphertext));
          const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
          const secret = body.schemaVersion === 2 ? secretFromDirectory(body) : body;
          nextSeed = secretToSeed(secret);
          deriveAddress(nextSeed, 0, 0, network);
          packedCopy = plaintext.slice();
        } catch {
          nextSeed?.fill(0);
          throw err("err.vault.wrongPassword");
        } finally { plaintext?.fill(0); }
        installSeed(nextSeed, started);
        packed?.fill(0);
        packed = packedCopy;
        unlockedCiphertext = record.ciphertext;
        sealingKey = encryptKey;
      });
    },
    // Sensitive actions such as revealing the mnemonic still re-check the password while unlocked. The session state stays as it is.
    async verifyPassword(password) {
      return exclusive(async () => {
        checkPassword(password);
        const record = await storage.getVault();
        const { salt, iv, ciphertext } = validateVaultRecord(record);
        const key = await passwordKey(crypto, password, salt, "decrypt");
        let plaintext;
        try {
          plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, key, ciphertext));
        } catch {
          throw err("err.vault.wrongPassword");
        } finally {
          plaintext?.fill(0);
        }
      });
    },
    describe(account = 0) {
      if (!seed || now() >= deadline) { lock(); throw err("err.vault.unlockRequired"); }
      touch();
      return describeAccount(seed, account, network);
    },
    secretSnapshot() {
      if (!packed || now() >= deadline) { lock(); throw err("err.vault.unlockRequired"); }
      touch();
      const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packed));
      const secret = body.schemaVersion === 2 ? secretFromDirectory(body) : body;
      return {
        kind: secret.kind,
        value: secret.value,
        imports: Array.isArray(secret.imports) ? secret.imports.map((item) => ({ ...item })) : [],
      };
    },
    directory() {
      if (!packed || now() >= deadline) { lock(); throw err("err.vault.unlockRequired"); }
      touch();
      const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packed));
      if (body.schemaVersion !== 2) throw err("err.vault.directoryInvalid");
      return body;
    },
    projectedBook(current = null) {
      const directory = this.directory();
      const { accounts, watch, imported } = projectAccounts(directory);
      // After a network switch the sealed directory may still hold the previous network's address. The displayed book must be re-derived for the current session network.
      for (const item of accounts) {
        item.address = this.address(0, 0, item.account ?? 0);
      }
      const items = [...accounts, ...imported, ...watch];
      const active = items.some((item) => item.id === current) ? current : (items[0]?.id || "d0");
      return { current: active, items };
    },
    address(branch = 0, index = 0, account = 0) {
      if (!seed || now() >= deadline) { lock(); throw err("err.vault.unlockRequired"); }
      touch();
      return deriveAddress(seed, branch, index, network, account);
    },
    async addPrivateKey(password, keyText, id) {
      return exclusive((started) => mutate(async () => {
        if (!seed || !packed || now() >= deadline) { lock(); throw err("err.vault.unlockBeforeImportKey"); }
        const key = normalizePrivateKey(keyText);
        const address = addressFromPrivateKey(key, network);
        const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packed));
        const secret = body.schemaVersion === 2 ? secretFromDirectory(body) : body;
        const imports = Array.isArray(secret.imports) ? secret.imports : [];
        if (imports.some((item) => item.address === address)) throw err("err.vault.importKeyDuplicateAddress");
        imports.push({ id, address, key: Array.from(key).map((b) => b.toString(16).padStart(2, "0")).join("") });
        key.fill(0);
        const book = body.schemaVersion === 2
          ? { items: projectAccounts(body).accounts.map((item) => ({
            ...item,
            receiveIndex: item.receiveIndex,
            changeIndex: item.changeIndex,
          })).concat(projectAccounts(body).watch) }
          : null;
        const { directory } = buildDirectory({
          secret: { kind: secret.kind, value: secret.value, imports },
          book,
          network,
        });
        const plaintext = new TextEncoder().encode(JSON.stringify(directory));
        try {
          const record = await storage.getVault();
          const { salt, iv, ciphertext } = validateVaultRecord(record);
          // Decrypt the existing ciphertext with the same password first, so a password change cannot be resealed with the old password.
          try {
            const oldKey = await passwordKey(crypto, password, salt, "decrypt");
            await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, oldKey, ciphertext);
          } catch {
            throw err("err.vault.wrongPasswordNotWritten");
          }
          const newIv = crypto.getRandomValues(new Uint8Array(12));
          const aes = await passwordKey(crypto, password, salt, "encrypt");
          const nextCipher = new Uint8Array(await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: newIv, additionalData: aad }, aes, plaintext,
          ));
          if (started !== generation) throw err("err.vault.cancelledRetry");
          const next = { ...record, iv: encode(newIv), ciphertext: encode(nextCipher) };
          await storage.setVault(next);
          packed.fill(0);
          packed = plaintext.slice();
          unlockedCiphertext = next.ciphertext;
          sealingKey = aes;
          return address;
        } finally { plaintext.fill(0); }
      }));
    },
    async persistDirectory(password, directory) {
      return exclusive((started) => mutate(async () => {
        if (!seed || !packed || now() >= deadline) { lock(); throw err("err.vault.unlockRequired"); }
        checkPassword(password);
        if (!directory || directory.schemaVersion !== 2) throw err("err.vault.directoryInvalid");
        const plaintext = new TextEncoder().encode(JSON.stringify(directory));
        try {
          await reseal(password, plaintext, started);
        } finally { plaintext.fill(0); }
      }));
    },
    // Reseal the account directory with the unlocked seed. The caller must not pass the mnemonic in again.
    async commitBook(password, book) {
      return exclusive((started) => mutate(async () => {
        if (!seed || !packed || now() >= deadline) { lock(); throw err("err.vault.unlockRequired"); }
        checkPassword(password);
        const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packed));
        const secret = body.schemaVersion === 2 ? secretFromDirectory(body) : body;
        const { directory } = buildDirectory({ secret, book, network });
        for (const account of directory.accounts) {
          const expected = deriveAddress(seed, 0, 0, network, account.account);
          if (account.address !== expected) throw err("err.vault.accountAddressMismatch");
        }
        const plaintext = new TextEncoder().encode(JSON.stringify(directory));
        try {
          await reseal(password, plaintext, started);
        } finally { plaintext.fill(0); }
      }));
    },
    // While unlocked, write the book back into the ciphertext with the session key. Skip the reseal when nothing changed.
    async noteBook(book, password) {
      return exclusive((started) => mutate(async () => {
        if (!seed || !packed || !sealingKey || now() >= deadline) { lock(); throw err("err.vault.unlockRequired"); }
        const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packed));
        const secret = body.schemaVersion === 2 ? secretFromDirectory(body) : body;
        const { directory } = buildDirectory({ secret, book, network });
        for (const account of directory.accounts) {
          if (deriveAddress(seed, 0, 0, network, account.account) !== account.address) {
            throw err("err.vault.accountAddressMismatch");
          }
        }
        if (body.schemaVersion === 2 && publicDirectory(body) === publicDirectory(directory)) return;
        if (watchRewritten(body, directory)) {
          checkPassword(password);
          const record = await storage.getVault();
          const { salt, iv, ciphertext } = validateVaultRecord(record);
          try {
            const key = await passwordKey(crypto, password, salt, "decrypt");
            await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, key, ciphertext);
          } catch (error) {
            if (error?.key) throw error;
            throw err("err.vault.wrongPasswordNotWritten");
          }
        }
        const plaintext = new TextEncoder().encode(JSON.stringify(directory));
        try {
          await resealWithSession(plaintext, started);
        } finally { plaintext.fill(0); }
      }));
    },
    async changePassword(current, nextPassword) {
      return exclusive((started) => mutate(async () => {
        if (!packed || now() >= deadline) { lock(); throw err("err.vault.unlockBeforeChangePassword"); }
        checkNewPassword(nextPassword);
        const record = await storage.getVault();
        const { salt, iv, ciphertext } = validateVaultRecord(record);
        const oldKey = await passwordKey(crypto, current, salt, "decrypt");
        await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, oldKey, ciphertext);
        const newSalt = crypto.getRandomValues(new Uint8Array(16));
        const newIv = crypto.getRandomValues(new Uint8Array(12));
        const aes = await passwordKey(crypto, nextPassword, newSalt, "encrypt");
        const encoded = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: newIv, additionalData: aad }, aes, packed));
        if (started !== generation) throw err("err.vault.cancelledRetry");
        const next = { version: 2, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt: encode(newSalt), iv: encode(newIv), ciphertext: encode(encoded) };
        await storage.setVault(next);
        unlockedCiphertext = next.ciphertext;
        sealingKey = aes;
      }));
    },
    mnemonic() {
      if (!packed || now() >= deadline) { lock(); throw err("err.vault.unlockRequired"); }
      touch();
      const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packed));
      const secret = body.schemaVersion === 2 ? secretFromDirectory(body) : body;
      if (secret.kind !== "mnemonic") return null;
      return secret.value;
    },
    importedKeys() {
      if (!packed || now() >= deadline) { lock(); throw err("err.vault.unlockRequired"); }
      touch();
      const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packed));
      const secret = body.schemaVersion === 2 ? secretFromDirectory(body) : body;
      return (secret.imports || []).map((item) => ({ id: item.id, address: item.address }));
    },
    signTransaction(draft) {
      if (busy || !seed || now() >= deadline) { lock(); throw err("err.vault.unlockConfirmDraft"); }
      try {
        const checked = validateDraft(draft);
        if (checked.network !== network) throw err("err.vault.txNetworkSessionMismatch");
        const account = checked.changePath?.account ?? checked.sourcePath.account ?? 0;
        if (deriveAddress(seed, 1, checked.changeIndex, network, account) !== checked.changeAddress) {
          throw err("err.vault.txPathNotInVault");
        }
        const hashes = signatureHashes(checked);
        const signatures = checked.inputs.map((input, index) => {
          const inputPath = input.path || checked.sourcePath;
          const inputAccount = inputPath.account ?? 0;
          const address = input.address || checked.sourceAddress;
          if (deriveAddress(seed, inputPath.branch, inputPath.index, network, inputAccount) !== address) {
            throw err("err.vault.txPathNotInVault");
          }
          return signTaprootHashes(
            seed, inputPath.branch, inputPath.index, [hashes[index]], crypto, network, inputAccount,
          )[0];
        });
        return finalizeTransaction(checked, signatures);
      } finally { lock(); }
    },
    async remove() {
      return exclusive(() => mutate(async () => {
        if (!seed || now() >= deadline) { lock(); throw err("err.vault.unlockBeforeDelete"); }
        const current = await storage.getVault();
        if (current?.ciphertext !== unlockedCiphertext) {
          lock(); throw err("err.vault.changedElsewhere");
        }
        lock();
        await storage.removeVault();
        exists = false;
      }));
    },
    lock, touch,
  };
}
