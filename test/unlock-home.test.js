import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseHTML } from "linkedom";
import { mountShell } from "../src/shell.js";

const ADDRESS = "prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4na";

test("an already unlocked vault opens home, and a second unlock tap does not show an error", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = false;
  const writes = [];
  const vault = {
    get status() { return { exists: true, unlocked, ready: true }; },
    async init() {},
    async unlock() {
      if (unlocked) throw new Error("保管库已经解锁");
      unlocked = true;
    },
    lock() { unlocked = false; },
    address() { return ADDRESS; },
    subscribe() { return () => {}; },
  };
  const storage = {
    async getVault() { return { version: 2 }; },
    async setVault(value) { writes.push(value); },
    async getBook() { return null; },
    async setBook() {},
    async getIdle() { return null; },
  };
  const app = mountShell(document, {
    vault,
    storage,
    async fetchAddress() { return { balance: 0n, activity: [], activityError: null }; },
    async fetchUtxos() { return []; },
    broadcaster: {},
    async copyText() {},
    async drawQr() {},
  });
  await app.ready;
  assert.equal(document.getElementById("screen-lock").hidden, false);

  document.getElementById("lockPw").value = "public-test-password-123";
  document.getElementById("lockUnlock").click();
  for (let i = 0; i < 40 && document.getElementById("screen-home").hidden; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(document.getElementById("screen-home").hidden, false);
  assert.equal(document.getElementById("lockError").textContent, "");
  assert.equal(document.getElementById("lockError").textContent.includes("保管库已经解锁"), false);
  assert.equal(document.getElementById("homeAddr").textContent, ADDRESS);

  for (let i = 0; i < 80 && document.getElementById("lockUnlock").dataset.busy === "1"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  document.getElementById("screen-home").hidden = true;
  document.getElementById("screen-lock").hidden = false;
  document.getElementById("lockPw").value = "public-test-password-123";
  document.getElementById("lockUnlock").click();
  for (let i = 0; i < 40 && document.getElementById("screen-home").hidden; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(document.getElementById("screen-home").hidden, false);
  assert.equal(document.getElementById("screen-lock").hidden, true);
  assert.equal(document.getElementById("lockError").textContent, "");
  assert.equal(document.getElementById("lockError").textContent.includes("保管库已经解锁"), false);
  assert.equal(writes.length, 0);
});

test("second mnemonic wallet is refused while a vault already exists", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  const previousDocument = globalThis.document;
  globalThis.document = document;
  let unlocked = false;
  let prepared = 0;
  let saved = 0;
  try {
    const vault = {
      get status() { return { exists: true, unlocked, ready: true }; },
      async init() {},
      async unlock() { unlocked = true; },
      lock() { unlocked = false; },
      address() { return ADDRESS; },
      async save() {
        saved += 1;
        throw new Error("已有保管库，请先解锁；不会覆盖");
      },
      subscribe() { return () => {}; },
    };
    const storage = {
      async getVault() { return { version: 2 }; },
      async setVault() {},
      async getBook() { return null; },
      async setBook() {},
      async getIdle() { return null; },
      async prepareAddLocalWallet() { prepared += 1; },
    };
    const app = mountShell(document, {
      vault,
      storage,
      async fetchAddress() { return { balance: 0n, activity: [], activityError: null }; },
      async fetchUtxos() { return []; },
      broadcaster: {},
      async copyText() {},
      async drawQr() {},
    });
    await app.ready;

    document.getElementById("lockPw").value = "public-test-password-123";
    document.getElementById("lockUnlock").click();
    for (let i = 0; i < 40 && document.getElementById("screen-home").hidden; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(document.getElementById("addMenuImport"), null);
    assert.equal(document.getElementById("chooseKey"), null);
    document.getElementById("importKind").value = "mnemonic";
    document.getElementById("importText").value = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    document.getElementById("importNext").click();
    for (let i = 0; i < 20; i += 1) {
      if (document.getElementById("importError").textContent) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(prepared, 0);
    assert.equal(saved, 0);
    assert.match(document.getElementById("importError").textContent, /one phrase vault|一个安装只保留一个助记词/);
    assert.equal(document.getElementById("screen-done").hidden, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("settings can delete current wallet with explicit second click", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = false;
  let exists = true;
  let removed = 0;
  let savedBook = null;
  const vault = {
    get status() { return { exists, unlocked, ready: true }; },
    async init() {},
    async unlock() { unlocked = true; },
    lock() { unlocked = false; },
    async remove() { removed += 1; exists = false; unlocked = false; },
    address() { return ADDRESS; },
    subscribe() { return () => {}; },
  };
  const storage = {
    async getVault() { return exists ? { version: 2 } : null; },
    async setVault() {},
    async getBook() { return null; },
    async setBook(book) { savedBook = structuredClone(book); },
    async getIdle() { return null; },
  };
  const app = mountShell(document, {
    vault,
    storage,
    async fetchAddress() { return { balance: 0n, activity: [], activityError: null }; },
    async fetchUtxos() { return []; },
    broadcaster: {},
    async copyText() {},
    async drawQr() {},
  });
  await app.ready;
  document.getElementById("lockPw").value = "public-test-password-123";
  document.getElementById("lockUnlock").click();
  for (let i = 0; i < 40 && document.getElementById("screen-home").hidden; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  document.querySelector('#bottomNav button[data-tab="screen-settings"]').click();
  for (let i = 0; i < 20 && document.getElementById("screen-settings").hidden; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  document.getElementById("removeVault").click();
  assert.equal(removed, 0);
  assert.equal(document.getElementById("screen-remove").hidden, false);
  document.getElementById("confirmRemove").click();
  assert.equal(removed, 0);
  document.getElementById("removePw").value = "public-test-password-123";
  document.getElementById("confirmRemove").click();
  for (let i = 0; i < 20 && document.getElementById("screen-welcome").hidden; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(removed, 1);
  assert.equal(document.getElementById("screen-welcome").hidden, false);
  assert.deepEqual(savedBook, { current: "d0", items: [] });
});
