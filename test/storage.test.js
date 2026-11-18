import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_LOCAL_WALLET_KEY,
  ADDRESS_KEY,
  LOCAL_WALLETS_KEY,
  WALLET_CONTEXT_KEY,
  createChromeStorage,
} from "../src/storage.js";
import { LIVE_ADDRESS } from "./samples.js";
import { VAULT_KEY } from "../src/vault.js";
import { speak } from "../src/i18n.js";

function errLike(pattern) {
  return (error) => {
    assert.match(speak(error, "en"), pattern);
    return true;
  };
}

function areaFrom(initial = {}) {
  const mem = { ...initial };
  const writes = [];
  return {
    mem,
    writes,
    area: {
      async get(key) {
        return mem[key] == null ? {} : { [key]: mem[key] };
      },
      async set(obj) {
        writes.push(obj);
        Object.assign(mem, obj);
      },
      async remove(key) {
        writes.push({ remove: key });
        for (const name of Array.isArray(key) ? key : [key]) delete mem[name];
      },
    },
  };
}

test("watch storage keeps a public address and explicitly clears local identity", async () => {
  const fake = areaFrom();
  const storage = createChromeStorage(fake.area);
  assert.equal(await storage.getAddress(), null);
  await storage.setAddress(LIVE_ADDRESS);
  assert.deepEqual(Object.keys(fake.mem), [ADDRESS_KEY, WALLET_CONTEXT_KEY]);
  assert.equal(fake.mem[WALLET_CONTEXT_KEY], null);
  assert.equal(fake.mem[ADDRESS_KEY], LIVE_ADDRESS);
  assert.deepEqual(Object.keys(fake.writes[0]), [ADDRESS_KEY, WALLET_CONTEXT_KEY]);
  await storage.clearAddress();
  assert.equal(ADDRESS_KEY in fake.mem, false);
  assert.equal(WALLET_CONTEXT_KEY in fake.mem, false);
});

test("a storage call that never returns is reported instead of hanging", async () => {
  const fake = areaFrom();
  fake.area.set = () => new Promise(() => {});
  const storage = createChromeStorage(fake.area, { timeoutMs: 20 });
  await assert.rejects(() => storage.setAddress(LIVE_ADDRESS), errLike(/did not respond/i));
});

test("rejects secret-shaped or non-string local records", async () => {
  const fake = areaFrom({ [ADDRESS_KEY]: { mnemonic: "abandon abandon", privateKey: "nope" } });
  const storage = createChromeStorage(fake.area);
  await assert.rejects(() => storage.getAddress(), errLike(/public address/i));
  await assert.rejects(() => storage.setAddress({ password: "secret" }));
});

test("vault storage rejects plaintext-shaped records and removes only the encrypted vault key", async () => {
  const fake = areaFrom({ [ADDRESS_KEY]: LIVE_ADDRESS });
  const storage = createChromeStorage(fake.area);
  await assert.rejects(() => storage.setVault({ mnemonic: "public invalid example" }), errLike(/vault|Encrypted/i));
  assert.equal(fake.writes.length, 0);
  const record = { version: 2, kdf: "PBKDF2-SHA256", iterations: 600000,
    salt: Buffer.alloc(16).toString("base64"), iv: Buffer.alloc(12).toString("base64"),
    ciphertext: Buffer.alloc(32).toString("base64") };
  await storage.setVault(record);
  assert.deepEqual(await storage.getVault(), record);
  assert.deepEqual(Object.keys(fake.writes[0]), [VAULT_KEY]);
  await storage.removeVault();
  assert.equal(await storage.getVault(), null);
  assert.equal(fake.mem[ADDRESS_KEY], LIVE_ADDRESS);
});


test("local identity is paired with its address and a watch switch removes it", async () => {
  const fake = areaFrom({ [ADDRESS_KEY]: LIVE_ADDRESS });
  const storage = createChromeStorage(fake.area);
  assert.equal(await storage.getWalletContext(LIVE_ADDRESS), null, "legacy addresses stay watch-only");
  const context = { kind: "local", address: LIVE_ADDRESS, branch: 1, index: 4 };
  const record = { version: 2, kdf: "PBKDF2-SHA256", iterations: 600000,
    salt: Buffer.alloc(16).toString("base64"), iv: Buffer.alloc(12).toString("base64"),
    ciphertext: Buffer.alloc(32).toString("base64") };
  await storage.setVault(record);
  await storage.setAddress(LIVE_ADDRESS, context);
  assert.deepEqual(await storage.getWalletContext(LIVE_ADDRESS), context);
  assert.deepEqual(fake.writes[1], { [ADDRESS_KEY]: LIVE_ADDRESS, [WALLET_CONTEXT_KEY]: context });
  const wallets = await storage.listLocalWallets();
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].address, LIVE_ADDRESS);
  assert.equal(wallets[0].branch, 1);
  assert.equal(wallets[0].index, 4);
  assert.equal(validWalletId(await storage.getActiveLocalWalletId()), true);
  assert.ok(Array.isArray(fake.mem[LOCAL_WALLETS_KEY]));
  assert.equal(typeof fake.mem[ACTIVE_LOCAL_WALLET_KEY], "string");
  await assert.rejects(() => storage.getWalletContext("different-address"), errLike(/inconsistent/i));
  await assert.rejects(() => storage.setAddress(LIVE_ADDRESS, { ...context, index: -1 }), errLike(/inconsistent/i));
  assert.ok(fake.writes.length >= 3);
  await storage.setAddress(LIVE_ADDRESS);
  assert.equal(await storage.getWalletContext(LIVE_ADDRESS), null);
});

test("prepareAddLocalWallet keeps previous wallet in list and clears active vault", async () => {
  const fake = areaFrom();
  const storage = createChromeStorage(fake.area);
  const record = { version: 2, kdf: "PBKDF2-SHA256", iterations: 600000,
    salt: Buffer.alloc(16).toString("base64"), iv: Buffer.alloc(12).toString("base64"),
    ciphertext: Buffer.alloc(32).toString("base64") };
  await storage.setVault(record);
  const context = { kind: "local", address: LIVE_ADDRESS, branch: 0, index: 0 };
  await storage.setAddress(LIVE_ADDRESS, context);
  const active = await storage.getActiveLocalWalletId();
  await storage.prepareAddLocalWallet(context);
  assert.equal(await storage.getVault(), null);
  const wallets = await storage.listLocalWallets();
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].id, active);
  assert.equal(await storage.getActiveLocalWalletId(), null);
});

test("switchLocalWallet loads selected vault and address context", async () => {
  const fake = areaFrom();
  const storage = createChromeStorage(fake.area);
  const recordA = { version: 2, kdf: "PBKDF2-SHA256", iterations: 600000,
    salt: Buffer.alloc(16, 1).toString("base64"), iv: Buffer.alloc(12, 2).toString("base64"),
    ciphertext: Buffer.alloc(32, 3).toString("base64") };
  const recordB = { version: 2, kdf: "PBKDF2-SHA256", iterations: 600000,
    salt: Buffer.alloc(16, 4).toString("base64"), iv: Buffer.alloc(12, 5).toString("base64"),
    ciphertext: Buffer.alloc(32, 6).toString("base64") };
  await storage.setVault(recordA);
  await storage.setAddress(LIVE_ADDRESS, { kind: "local", address: LIVE_ADDRESS, branch: 0, index: 0 });
  const first = await storage.listLocalWallets();
  await storage.prepareAddLocalWallet({ kind: "local", address: LIVE_ADDRESS, branch: 0, index: 0 });
  const nextAddress = "prl1pglwzxm30w89uhqqxj8x4phpf8c2jgl3x6kzdhj3m2hcy9d2fe7lqxn53yc";
  await storage.setVault(recordB);
  await storage.setAddress(nextAddress, { kind: "local", address: nextAddress, branch: 1, index: 2 });
  const wallets = await storage.listLocalWallets();
  assert.equal(wallets.length, 2);
  const target = wallets.find((wallet) => wallet.id === first[0].id);
  const switched = await storage.switchLocalWallet(target.id);
  assert.equal(switched.address, LIVE_ADDRESS);
  assert.equal((await storage.getAddress()), LIVE_ADDRESS);
  assert.deepEqual(await storage.getWalletContext(LIVE_ADDRESS), {
    kind: "local", address: LIVE_ADDRESS, branch: 0, index: 0,
  });
});

function validWalletId(value) {
  return typeof value === "string" && /^[a-z0-9]{8,32}$/.test(value);
}
