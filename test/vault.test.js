import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createVault } from "../src/vault.js";
import { speak } from "../src/i18n.js";

function errLike(pattern) {
  return (error) => {
    assert.match(speak(error, "en"), pattern);
    return true;
  };
}

const fixture = JSON.parse(readFileSync(new URL("../src/pearl-v1.5.5.json", import.meta.url)));
const password = "public-test-password-123";
function harness(options = {}) {
  const records = [];
  let record = null;
  const storage = {
    async getVault() { return structuredClone(record); },
    async setVault(value) { record = structuredClone(value); records.push(record); },
    async removeVault() { record = null; },
  };
  const locks = { request(_name, _options, work) { return work(); } };
  return { storage, records, locks, mutate(work) { work(record); }, vault: createVault({ storage, locks, ...options }) };
}

test("vault persists only authenticated ciphertext, reopens locked and unlocks original address", async () => {
  const h = harness();
  await h.vault.init();
  await h.vault.save("hex", fixture.seedHex, password);
  assert.equal(h.vault.address(), fixture.vectors[0].address);
  const stored = JSON.stringify(h.records);
  for (const secret of [fixture.seedHex, password, "privateKey", "mnemonic"]) assert.equal(stored.includes(secret), false);
  assert.deepEqual(Object.keys(h.records[0]).sort(), ["ciphertext", "iterations", "iv", "kdf", "salt", "version"]);
  const reopened = createVault({ storage: h.storage, locks: h.locks });
  await reopened.init();
  assert.equal(reopened.status.unlocked, false);
  assert.throws(() => reopened.address(), errLike(/Unlock/));
  await assert.rejects(() => reopened.unlock("incorrect-password"), errLike(/Wrong password/));
  assert.equal(reopened.status.unlocked, false);
  await reopened.unlock(password);
  assert.equal(reopened.address(1, 4), fixture.vectors[9].address);
  assert.deepEqual(reopened.secretSnapshot(), { kind: "hex", value: fixture.seedHex, imports: [] });
  await assert.rejects(() => reopened.save("hex", fixture.seedHex, password), errLike(/already exists/));
  await assert.rejects(() => reopened.verifyPassword("incorrect-password"), errLike(/Wrong password/));
  await reopened.verifyPassword(password);
  assert.equal(reopened.status.unlocked, true);
  reopened.lock(); h.vault.lock();
});

test("vault rejects ciphertext/salt/IV tampering and unsupported KDF parameters", async () => {
  const h = harness();
  await h.vault.init();
  await h.vault.save("mnemonic", fixture.bip39.mnemonic, password);
  h.vault.lock();
  const original = structuredClone(h.records[0]);
  for (const key of ["ciphertext", "salt", "iv"]) {
    h.mutate((record) => {
      Object.assign(record, original);
      const data = Buffer.from(record[key], "base64"); data[0] ^= 1; record[key] = data.toString("base64");
    });
    await assert.rejects(() => h.vault.unlock(password), errLike(/Wrong password/));
    assert.equal(h.vault.status.unlocked, false);
  }
  h.mutate((record) => { Object.assign(record, original); record.iterations = 1; });
  await assert.rejects(() => h.vault.unlock(password), errLike(/damaged|corrupted/i));
});

test("random salt and IV produce different records for the same public test secret", async () => {
  const first = harness(); const second = harness();
  await first.vault.init(); await second.vault.init();
  await first.vault.save("hex", fixture.seedHex, password);
  await second.vault.save("hex", fixture.seedHex, password);
  for (const key of ["salt", "iv", "ciphertext"]) assert.notEqual(first.records[0][key], second.records[0][key]);
  first.vault.lock(); second.vault.lock();
});

test("deadline enforces auto-lock even if a suspended popup timer has not fired", async () => {
  let time = 100;
  let callback;
  const h = harness({ now: () => time, idleMs: 1000, schedule(work) { callback = work; return 1; }, cancel() {} });
  await h.vault.init();
  await h.vault.save("hex", fixture.seedHex, password);
  time += 900;
  h.vault.touch();
  time += 900;
  assert.equal(h.vault.status.unlocked, true);
  time += 101;
  assert.throws(() => h.vault.address(), errLike(/Unlock/));
  await h.vault.unlock(password);
  callback();
  assert.equal(h.vault.status.unlocked, false);
});

test("locking while decrypting or saving prevents a late asynchronous unlock", async () => {
  const h = harness();
  await h.vault.init();
  const saving = h.vault.save("hex", fixture.seedHex, password);
  h.vault.lock();
  await assert.rejects(() => saving, errLike(/cancelled by lock/i));
  assert.equal(h.records.length, 0);
  await h.vault.save("hex", fixture.seedHex, password);
  h.vault.lock();
  const unlocking = h.vault.unlock(password);
  h.vault.lock();
  await assert.rejects(() => unlocking, errLike(/cancelled by lock/i));
  assert.equal(h.vault.status.unlocked, false);
});

test("storage failures preserve locked state and never overwrite an existing vault", async () => {
  const h = harness();
  await h.vault.init();
  h.storage.setVault = async () => { throw new Error("test storage failure"); };
  await assert.rejects(() => h.vault.save("hex", fixture.seedHex, password), /storage failure/);
  assert.equal(h.vault.status.unlocked, false);
  assert.equal(h.records.length, 0);
  await assert.rejects(() => h.vault.save("hex", fixture.seedHex, "short"), errLike(/Wrong password/));
  await assert.rejects(() => h.vault.save("hex", fixture.seedHex, "1234567"), errLike(/Wrong password/));
});

test("vault removal requires unlock and leaves no encrypted record", async () => {
  const h = harness();
  await h.vault.init();
  await h.vault.save("hex", fixture.seedHex, password);
  h.vault.lock();
  await assert.rejects(() => h.vault.remove(), errLike(/Unlock/));
  await h.vault.unlock(password);
  await h.vault.remove();
  assert.equal(await h.storage.getVault(), null);
  assert.equal(h.vault.status.exists, false);
  assert.equal(h.vault.status.unlocked, false);
});

test("Web Locks serialize simultaneous creation and prevent overwriting the first vault", async () => {
  const h = harness();
  let queue = Promise.resolve();
  const locks = { request(_name, _options, work) {
    const result = queue.then(work); queue = result.catch(() => {}); return result;
  } };
  const first = createVault({ storage: h.storage, locks });
  const second = createVault({ storage: h.storage, locks });
  await first.init(); await second.init();
  const results = await Promise.allSettled([
    first.save("hex", fixture.seedHex, password),
    second.save("mnemonic", fixture.bip39.mnemonic, password),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.match(speak(results[1].reason, "en"), /already exists/);
  assert.equal(h.records.length, 1);
  first.lock(); second.lock();
});

test("missing Web Locks fails closed before writing", async () => {
  const h = harness({ locks: null }); await h.vault.init();
  await assert.rejects(() => h.vault.save("hex", fixture.seedHex, password), errLike(/Web Locks/));
  assert.equal(h.records.length, 0);
});

test("addPrivateKey refuses to reseal with the wrong password after a password change", async () => {
  const h = harness();
  await h.vault.init();
  await h.vault.save("hex", fixture.seedHex, password);
  const nextPassword = "public-test-password-456";
  await h.vault.changePassword(password, nextPassword);
  const key = "11".repeat(32);
  await assert.rejects(() => h.vault.addPrivateKey(password, key, "k1"), errLike(/Wrong password|damaged/i));
  await h.vault.addPrivateKey(nextPassword, key, "k1");
  const imported = h.vault.importedKeys();
  assert.equal(imported.length, 1);
  h.vault.lock();
  await h.vault.unlock(nextPassword);
  assert.equal(h.vault.importedKeys().length, 1);
});

test("save stores directory schema version 2 plaintext", async () => {
  const h = harness();
  await h.vault.init();
  await h.vault.save("hex", fixture.seedHex, password);
  const directory = h.vault.directory();
  assert.equal(directory.schemaVersion, 2);
  assert.equal(directory.accounts[0].receiveNext, 0);
  assert.ok(directory.accounts[0].receiveDescriptor.startsWith("tr(["));
  h.vault.lock();
});

test("reseal ignores descriptors supplied by the account book", async () => {
  const h = harness();
  await h.vault.init();
  await h.vault.save("hex", fixture.seedHex, password);
  const real = h.vault.directory().accounts[0].receiveDescriptor;
  await h.vault.noteBook({
    current: "d0",
    items: [{
      id: "d0", name: "账户 1", kind: "derived", account: 0,
      receiveDescriptor: "tr(attacker)",
      changeDescriptor: "tr(attacker-change)",
      receiveIndex: 1,
      changeIndex: 0,
    }],
  });
  const account = h.vault.directory().accounts[0];
  assert.equal(account.receiveDescriptor, real);
  assert.equal(account.receiveDescriptor.includes("attacker"), false);
  assert.equal(account.changeDescriptor.includes("attacker"), false);
  assert.equal(account.receiveNext, 1);
  h.vault.lock();
});

test("commitBook keeps a second HD account after reopen and refuses a wrong password", async () => {
  const h = harness();
  await h.vault.init();
  await h.vault.save("hex", fixture.seedHex, password);
  const first = h.vault.address(0, 0, 0);
  const second = h.vault.address(0, 0, 1);
  const before = h.vault.directory().accounts.length;
  await h.vault.commitBook(password, {
    current: "d1",
    items: [
      { id: "d0", name: "账户 1", kind: "derived", account: 0, address: first, receiveIndex: 0, changeIndex: 0 },
      { id: "d1", name: "账户 2", kind: "derived", account: 1, address: second, receiveIndex: 2, changeIndex: 1 },
    ],
  });
  assert.equal(h.vault.directory().accounts.length, before + 1);
  assert.equal(h.vault.directory().accounts[1].address, second);
  assert.equal(h.vault.directory().accounts[1].receiveNext, 2);
  const ciphertext = h.records.at(-1).ciphertext;
  await assert.rejects(() => h.vault.commitBook("wrong-password-xxxx", {
    current: "d1",
    items: [{ id: "d9", kind: "derived", account: 9, address: first }],
  }), errLike(/not saved/));
  assert.equal(h.records.at(-1).ciphertext, ciphertext);
  h.vault.lock();
  await h.vault.unlock(password);
  const projected = h.vault.projectedBook("d1");
  assert.equal(projected.current, "d1");
  assert.deepEqual(projected.items.filter((item) => item.kind === "derived").map((item) => item.account), [0, 1]);
  h.vault.lock();
});

test("noteBook stores cursors with the unlock session and still opens after a password change", async () => {
  const h = harness();
  await h.vault.init();
  await h.vault.save("hex", fixture.seedHex, password);
  const address = h.vault.address(0, 0, 0);
  const book = {
    current: "d0",
    items: [{ id: "d0", name: "账户 1", kind: "derived", account: 0, address, receiveIndex: 3, changeIndex: 1 }],
  };
  const before = h.records.at(-1).ciphertext;
  await h.vault.noteBook(book);
  assert.notEqual(h.records.at(-1).ciphertext, before);
  assert.equal(h.vault.directory().accounts[0].receiveNext, 3);
  assert.equal(h.vault.directory().accounts[0].changeNext, 1);
  const stable = h.records.at(-1).ciphertext;
  await h.vault.noteBook(book);
  assert.equal(h.records.at(-1).ciphertext, stable);
  const nextPassword = "public-test-password-456";
  await h.vault.changePassword(password, nextPassword);
  await h.vault.noteBook({
    current: "d0",
    items: [{ id: "d0", name: "改名", kind: "derived", account: 0, address, receiveIndex: 4, changeIndex: 1 }],
  });
  h.vault.lock();
  await assert.rejects(() => h.vault.noteBook(book), errLike(/Unlock/));
  await h.vault.unlock(nextPassword);
  assert.equal(h.vault.directory().accounts[0].name, "改名");
  assert.equal(h.vault.directory().accounts[0].receiveNext, 4);
  h.vault.lock();
});

test("noteBook refuses a new watch address until the password decrypts, and still stores cursors without one", async () => {
  const h = harness();
  await h.vault.init();
  await h.vault.save("hex", fixture.seedHex, password);
  const address = h.vault.address(0, 0, 0);
  const watched = h.vault.address(0, 1, 0);
  const book = {
    current: "d0",
    items: [{ id: "d0", name: "账户 1", kind: "derived", account: 0, address, receiveIndex: 2, changeIndex: 0 }],
  };
  await h.vault.noteBook(book);
  const withWatch = {
    current: "w1",
    items: [
      book.items[0],
      { id: "w1", name: "观察", kind: "watch", address: watched },
    ],
  };
  await assert.rejects(() => h.vault.noteBook(withWatch), errLike(/Wrong password/));
  assert.equal(h.vault.directory().watch.length, 0);
  await h.vault.noteBook(withWatch, password);
  assert.equal(h.vault.directory().watch[0].address, watched);
  await h.vault.noteBook({
    ...withWatch,
    items: [{ ...book.items[0], receiveIndex: 5 }, withWatch.items[1]],
  });
  assert.equal(h.vault.directory().accounts[0].receiveNext, 5);
  h.vault.lock();
});

test("a new password cannot be only letters or digits under 12 characters, including padding", async () => {
  const h = harness();
  await h.vault.init();
  await h.vault.save("hex", fixture.seedHex, password);
  await assert.rejects(() => h.vault.changePassword(password, "abcdefgh"), errLike(/only letters or only numbers/));
  await assert.rejects(() => h.vault.changePassword(password, "abcdefgh "), errLike(/only letters or only numbers/));
  await h.vault.lock();
  await h.vault.unlock(password);
  h.vault.lock();
});
