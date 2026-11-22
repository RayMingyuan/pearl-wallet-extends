import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseHTML } from "linkedom";
import { handlePopupDraftMessage, handleVaultMessage } from "../src/background.js";
import { derivedSearchLimit, mountShell, swapNetworkCursors } from "../src/shell.js";
import { isShortUniformPassword } from "../src/password-policy.js";
import { explorerTxUrl } from "../src/networks.js";
import {
  POPUP_DRAFT_TTL_MS,
  POPUP_SECRET_DRAFT_TTL_MS,
  createPopupDraftMemory,
  sanitizePopupDraft,
} from "../src/popup-draft.js";

const HTML = readFileSync(new URL("../src/popup.html", import.meta.url), "utf8");
const ADDRESS = "prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4na";
const PASSWORD = "test-password";

function freshDocument() {
  return parseHTML(HTML).document;
}

async function until(predicate, attempts = 100) {
  for (let i = 0; i < attempts; i += 1) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

function draftStore(initial = null) {
  let value = initial;
  return {
    async getPopupDraft() { return value; },
    async setPopupDraft(draft) { value = draft; },
    async clearPopupDraft() { value = null; },
  };
}

function mount(document, { vault, storage, estimateFees }) {
  return mountShell(document, {
    vault,
    storage,
    async fetchAddress() { return { balance: 0n, txCount: 0, activity: [] }; },
    async fetchUtxos() { return []; },
    broadcaster: {},
    estimateFees: estimateFees || (async () => ({ menu: { slow: 1, standard: 2, fast: 3 }, fallback: true })),
    async copyText() {},
    async drawQr() {},
  });
}

test("sanitize keeps a send form and drops a recovery phrase left on the password screen", () => {
  assert.equal(sanitizePopupDraft(null), null);
  assert.equal(sanitizePopupDraft({ v: 1, at: Date.now(), screen: "screen-home" }), null);
  const expired = sanitizePopupDraft({
    v: 1,
    at: Date.now() - POPUP_DRAFT_TTL_MS - 1,
    screen: "screen-send",
    sendTo: ADDRESS,
  });
  assert.equal(expired, null);
  const send = sanitizePopupDraft({
    v: 1,
    at: Date.now(),
    screen: "screen-confirm",
    sendTo: ADDRESS,
    sendAmount: "0.5",
    fee: "fast",
    custom: true,
    customRate: "100",
  });
  assert.equal(send.screen, "screen-send");
  assert.equal(send.flow, "send");
  assert.equal(send.fee, "fast");
  assert.equal(send.customRate, "100");
  const setup = sanitizePopupDraft({
    v: 1,
    at: Date.now(),
    screen: "screen-password",
    mnemonic: "abandon ability able",
    password: PASSWORD,
  });
  assert.equal(setup.mnemonic, "");
  assert.equal(setup.password, PASSWORD);
  const staleSecret = sanitizePopupDraft({
    v: 1,
    at: Date.now() - POPUP_SECRET_DRAFT_TTL_MS - 1,
    screen: "screen-mnemonic",
    mnemonic: "abandon ability able about above absent absorb abstract absurd abuse access accident",
    password: PASSWORD,
  });
  assert.equal(staleSecret, null);
  const sendStillFresh = sanitizePopupDraft({
    v: 1,
    at: Date.now() - POPUP_SECRET_DRAFT_TTL_MS - 1,
    screen: "screen-send",
    sendTo: ADDRESS,
  });
  assert.equal(sendStillFresh.sendTo, ADDRESS);
});

test("an in-progress form stays in offscreen memory and never touches the vault or session store", async () => {
  const memory = createPopupDraftMemory();
  let opened = 0;
  const phrase = "abandon ability able about above absent absorb abstract absurd abuse access accident";
  const saved = await handlePopupDraftMessage({
    target: "popup-draft",
    op: "set",
    draft: { v: 1, at: Date.now(), screen: "screen-mnemonic", mnemonic: phrase },
  }, {
    async ensureOffscreen() { opened += 1; },
    dispatch: (message) => memory.handle(message),
  });
  assert.equal(opened, 1);
  assert.equal(saved.draft.mnemonic, phrase);
  const again = await handlePopupDraftMessage({ target: "popup-draft", op: "get" }, {
    async ensureOffscreen() {},
    dispatch: (message) => memory.handle(message),
  });
  assert.equal(again.draft.mnemonic, phrase);
  let vaultCalls = 0;
  const rejected = await handleVaultMessage({ target: "popup-draft", op: "set", draft: { mnemonic: phrase } }, {
    async readVault() { vaultCalls += 1; },
    async writeVault() { vaultCalls += 1; },
    async removeVault() { vaultCalls += 1; },
    async writeSession() { vaultCalls += 1; },
    async clearSession() { vaultCalls += 1; },
    async ensureOffscreen() { vaultCalls += 1; },
    async dispatch() { vaultCalls += 1; },
  });
  assert.equal(rejected.ok, false);
  assert.equal(vaultCalls, 0);
  const cleared = await handlePopupDraftMessage({ target: "popup-draft", op: "clear" }, {
    async ensureOffscreen() {},
    dispatch: (message) => memory.handle(message),
  });
  assert.equal(cleared.draft, null);
});

test("leaving send and coming back restores the address and custom fee", async () => {
  const drafts = draftStore();
  const book = {
    current: "d0",
    items: [{
      id: "d0", name: "Account 1", kind: "derived", account: 0,
      address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 1,
    }],
  };
  function vault(unlocked = true) {
    let open = unlocked;
    return {
      get status() { return { exists: true, unlocked: open, ready: true }; },
      async init() {},
      lock() { open = false; },
      async unlock() { open = true; },
      async address() { return ADDRESS; },
      subscribe() { return () => {}; },
    };
  }
  const firstDoc = freshDocument();
  const first = mount(firstDoc, {
    vault: vault(true),
    storage: {
      ...drafts,
      async getVault() { return { version: 2 }; },
      async getBook() { return book; },
      async setBook() {},
    },
  });
  await first.ready;
  firstDoc.getElementById("goSend").click();
  assert.equal(await until(() => drafts.getPopupDraft().then((draft) => draft?.screen === "screen-send")), true);
  firstDoc.getElementById("sendTo").value = ADDRESS;
  firstDoc.getElementById("sendTo").dispatchEvent(new firstDoc.defaultView.Event("input"));
  firstDoc.getElementById("sendAmount").value = "0.5";
  firstDoc.getElementById("sendAmount").dispatchEvent(new firstDoc.defaultView.Event("input"));
  firstDoc.getElementById("customRate").value = "100";
  firstDoc.getElementById("customRate").dispatchEvent(new firstDoc.defaultView.Event("input"));
  assert.equal(await until(() => drafts.getPopupDraft().then((draft) => draft?.sendTo === ADDRESS && draft?.customRate === "100")), true);

  const secondDoc = freshDocument();
  const second = mount(secondDoc, {
    vault: vault(true),
    storage: {
      ...drafts,
      async getVault() { return { version: 2 }; },
      async getBook() { return book; },
      async setBook() {},
    },
  });
  await second.ready;
  assert.equal(secondDoc.getElementById("screen-send").hidden, false);
  assert.equal(secondDoc.getElementById("screen-home").hidden, true);
  assert.equal(secondDoc.getElementById("sendTo").value, ADDRESS);
  assert.equal(secondDoc.getElementById("sendAmount").value, "0.5");
  assert.equal(secondDoc.getElementById("customRate").value, "100");
  assert.equal(secondDoc.getElementById("customFeeEst").hidden, false);
  assert.match(secondDoc.getElementById("customFeeEst").textContent, /0\.00018/);
  assert.equal(secondDoc.getElementById("fee-standard").getAttribute("aria-checked"), "false");

  secondDoc.querySelector("#screen-send [data-back]").click();
  assert.equal(await until(() => drafts.getPopupDraft().then((draft) => draft == null)), true);
  assert.equal(secondDoc.getElementById("screen-home").hidden, false);
});

test("a locked wallet keeps the send form and returns to it after the password", async () => {
  const drafts = draftStore({
    v: 1,
    at: Date.now(),
    screen: "screen-send",
    flow: "send",
    sendTo: ADDRESS,
    sendAmount: "1",
    sendMax: false,
    fee: "standard",
    custom: false,
    customRate: "",
  });
  const book = {
    current: "d0",
    items: [{
      id: "d0", name: "Account 1", kind: "derived", account: 0,
      address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 1,
    }],
  };
  let unlocked = false;
  const document = freshDocument();
  const app = mount(document, {
    vault: {
      get status() { return { exists: true, unlocked, ready: true }; },
      async init() {},
      lock() { unlocked = false; },
      async unlock() { unlocked = true; },
      async address() { return ADDRESS; },
      subscribe() { return () => {}; },
    },
    storage: {
      ...drafts,
      async getVault() { return { version: 2 }; },
      async getBook() { return book; },
      async setBook() {},
    },
  });
  await app.ready;
  assert.equal(document.getElementById("screen-lock").hidden, false);
  assert.equal(document.getElementById("screen-send").hidden, true);
  assert.equal(document.getElementById("screen-home").hidden, true);
  assert.equal((await drafts.getPopupDraft()).sendTo, ADDRESS);
  document.getElementById("lockPw").value = PASSWORD;
  document.getElementById("lockUnlock").click();
  assert.equal(await until(() => document.getElementById("screen-send").hidden === false), true);
  assert.equal(document.getElementById("sendTo").value, ADDRESS);
  assert.equal(document.getElementById("sendAmount").value, "1");
});

test("creating a wallet resumes the same recovery phrase instead of the welcome screen", async () => {
  const drafts = draftStore();
  let saved = null;
  let unlocked = false;
  function vault() {
    return {
      get status() { return { exists: false, unlocked, ready: true }; },
      async init() {},
      async save(kind, value, password) {
        saved = { kind, value, password };
        unlocked = true;
      },
      async address() { return ADDRESS; },
      subscribe() { return () => {}; },
    };
  }
  function storage() {
    return {
      ...drafts,
      async getVault() { return null; },
      async getBook() { return null; },
      async setBook() {},
    };
  }
  const firstDoc = freshDocument();
  const first = mount(firstDoc, { vault: vault(), storage: storage() });
  await first.ready;
  firstDoc.getElementById("createWallet").click();
  assert.equal(await until(() => firstDoc.getElementById("screen-password").hidden === false), true);
  firstDoc.getElementById("pw1").value = PASSWORD;
  firstDoc.getElementById("pw2").value = PASSWORD;
  firstDoc.getElementById("pwNext").click();
  assert.equal(await until(() => firstDoc.getElementById("screen-notice").hidden === false), true);
  firstDoc.getElementById("ackRisk").checked = true;
  firstDoc.getElementById("noticeNext").click();
  assert.equal(await until(() => firstDoc.getElementById("screen-mnemonic").hidden === false), true);
  firstDoc.getElementById("revealWords").click();
  assert.equal(await until(() => drafts.getPopupDraft().then((draft) => draft?.wordsRevealed === true && draft.mnemonic)), true);
  const phrase = (await drafts.getPopupDraft()).mnemonic;
  assert.equal(phrase.split(" ").length, 12);

  const secondDoc = freshDocument();
  const second = mount(secondDoc, { vault: vault(), storage: storage() });
  await second.ready;
  assert.equal(secondDoc.getElementById("screen-mnemonic").hidden, false);
  assert.equal(secondDoc.getElementById("screen-welcome").hidden, true);
  for (const word of phrase.split(" ")) {
    assert.equal(secondDoc.getElementById("wordGrid").textContent.includes(word), true);
  }
  secondDoc.getElementById("ackHand").checked = true;
  secondDoc.getElementById("mnemonicNext").click();
  assert.equal(await until(() => secondDoc.getElementById("screen-verify").hidden === false), true);
  const words = phrase.split(" ");
  for (const index of [2, 6, 11]) {
    const chip = [...secondDoc.querySelectorAll("#verifyFields .chip-word")]
      .find((item) => item.dataset.word === words[index] && !item.disabled);
    assert.ok(chip);
    chip.click();
  }
  secondDoc.getElementById("verifyNext").click();
  assert.equal(await until(() => saved != null), true);
  assert.equal(saved.value, phrase);
  assert.equal(saved.password, PASSWORD);
  assert.equal(await until(() => drafts.getPopupDraft().then((draft) => draft == null)), true);
  assert.equal(secondDoc.getElementById("screen-done").hidden, false);
});

test("an expired or already-saved create draft does not reopen the recovery phrase", async () => {
  const phrase = "abandon ability able about above absent absorb abstract absurd abuse access accident";
  const expired = draftStore({
    v: 1,
    at: Date.now() - POPUP_DRAFT_TTL_MS - 5_000,
    screen: "screen-mnemonic",
    flow: "create",
    mnemonic: phrase,
    password: PASSWORD,
    wordsRevealed: true,
  });
  const welcome = freshDocument();
  const welcomeApp = mount(welcome, {
    vault: {
      get status() { return { exists: false, unlocked: false, ready: true }; },
      async init() {},
      subscribe() { return () => {}; },
    },
    storage: {
      ...expired,
      async getVault() { return null; },
      async getBook() { return null; },
    },
  });
  await welcomeApp.ready;
  assert.equal(welcome.getElementById("screen-welcome").hidden, false);
  assert.equal(welcome.getElementById("screen-mnemonic").hidden, true);
  assert.equal(await expired.getPopupDraft(), null);

  const leftover = draftStore({
    v: 1,
    at: Date.now(),
    screen: "screen-mnemonic",
    flow: "create",
    mnemonic: phrase,
    password: PASSWORD,
    wordsRevealed: true,
    mnemonicWords: 12,
  });
  const home = freshDocument();
  const homeApp = mount(home, {
    vault: {
      get status() { return { exists: true, unlocked: true, ready: true }; },
      async init() {},
      async address() { return ADDRESS; },
      subscribe() { return () => {}; },
    },
    storage: {
      ...leftover,
      async getVault() { return { version: 2 }; },
      async getBook() {
        return {
          current: "d0",
          items: [{
            id: "d0", name: "Account 1", kind: "derived", account: 0,
            address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 1,
          }],
        };
      },
      async setBook() {},
    },
  });
  await homeApp.ready;
  assert.equal(home.getElementById("screen-mnemonic").hidden, true);
  assert.equal(home.getElementById("wordGrid").textContent.includes("abandon"), false);
  assert.equal(await leftover.getPopupDraft(), null);
});

test("a secret draft is wiped in memory when its short timer fires", () => {
  let now = 1_000_000;
  let scheduled = null;
  const memory = createPopupDraftMemory({
    now: () => now,
    schedule(fn, wait) { scheduled = { fn, wait }; return 1; },
    cancel() { scheduled = null; },
  });
  const phrase = "abandon ability able about above absent absorb abstract absurd abuse access accident";
  const saved = memory.handle({
    op: "set",
    draft: { v: 1, at: now, screen: "screen-mnemonic", mnemonic: phrase, password: PASSWORD },
  });
  assert.equal(saved.draft.mnemonic, phrase);
  assert.equal(scheduled.wait, POPUP_SECRET_DRAFT_TTL_MS);
  scheduled.fn();
  assert.equal(memory.handle({ op: "get" }).draft, null);
});

test("short letter-only and digit-only passwords stay on the password screen", async () => {
  const document = freshDocument();
  const app = mount(document, {
    vault: {
      get status() { return { exists: false, unlocked: false, ready: true }; },
      async init() {},
      subscribe() { return () => {}; },
    },
    storage: {
      ...draftStore(),
      async getVault() { return null; },
      async getBook() { return null; },
    },
  });
  await app.ready;
  document.getElementById("createWallet").click();
  assert.equal(await until(() => document.getElementById("screen-password").hidden === false), true);
  for (const weak of ["abcdefgh", "12345678", "abcdefgh ", "abcdefg\u200Bh"]) {
    document.getElementById("pw1").value = weak;
    document.getElementById("pw2").value = weak;
    document.getElementById("pw1").dispatchEvent(new document.defaultView.Event("input"));
    document.getElementById("pwNext").click();
    assert.equal(document.getElementById("screen-password").hidden, false);
    assert.match(document.getElementById("pwError").textContent, /only letters or only numbers/);
  }
  assert.equal(isShortUniformPassword("abcdefgh "), true);
  assert.equal(isShortUniformPassword("abcdefg\u200Bh"), true);
  assert.equal(isShortUniformPassword("abcdefgh!"), false);
  assert.equal(isShortUniformPassword("abcdefghijkl"), false);
  document.getElementById("pw1").value = "abc12345";
  document.getElementById("pw2").value = "abc12345";
  document.getElementById("pwNext").click();
  assert.equal(await until(() => document.getElementById("screen-notice").hidden === false), true);
});

test("switching networks restores that network's derivation cursor", () => {
  const items = [{ id: "d0", kind: "derived", receiveIndex: 5, changeIndex: 2 }];
  const first = swapNetworkCursors(items, {}, "Pearl mainnet", "Pearl testnet");
  assert.equal(first.items[0].receiveIndex, 0);
  assert.equal(first.items[0].changeIndex, 0);
  assert.equal(first.buckets["Pearl mainnet"].d0.receiveNext, 5);
  const back = swapNetworkCursors(first.items, first.buckets, "Pearl testnet", "Pearl mainnet");
  assert.equal(back.items[0].receiveIndex, 5);
  assert.equal(back.items[0].changeIndex, 2);
  assert.equal(derivedSearchLimit({ receiveIndex: 0 }, 80), 100);
});

const TXID = "ab".repeat(32);

function unlockedVault() {
  return {
    get status() { return { exists: true, unlocked: true, ready: true }; },
    async init() {},
    async address() { return ADDRESS; },
    subscribe() { return () => {}; },
  };
}

function stored(drafts) {
  return {
    ...drafts,
    async getVault() { return { version: 2 }; },
    async getBook() {
      return {
        current: "d0",
        items: [{
          id: "d0", name: "Account 1", kind: "derived", account: 0,
          address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 1,
        }],
      };
    },
    async setBook() {},
  };
}

test("page drafts keep public fields and drop secrets", () => {
  const now = Date.now();
  const status = sanitizePopupDraft({
    v: 1, at: now, screen: "screen-status", status: "broadcast", txid: TXID,
    confirmations: 1, endpoint: "blockbook.example", mnemonic: "abandon", password: PASSWORD,
  });
  assert.equal(status.flow, "status");
  assert.equal(status.txid, TXID);
  assert.equal(status.confirmations, 1);
  assert.equal(status.mnemonic, undefined);
  assert.equal(status.password, undefined);
  assert.equal(sanitizePopupDraft({ v: 1, at: now, screen: "screen-tx", txid: "zz" }), null);
  const tx = sanitizePopupDraft({
    v: 1, at: now, screen: "screen-tx", txid: TXID, direction: "in", amount: "100000000",
    confirmations: 1, back: "screen-home", rawHex: "dead",
  });
  assert.equal(tx.amount, "100000000");
  assert.equal(tx.back, "screen-home");
  assert.equal(tx.rawHex, undefined);
  const network = sanitizePopupDraft({
    v: 1, at: now, flow: "network", networkId: "Pearl testnet", scheme: "http", host: " 127.0.0.1 ", port: "18332",
  });
  assert.equal(network.host, "127.0.0.1");
  assert.equal(network.scheme, "http");
  assert.equal(network.port, "18332");
  const secret = sanitizePopupDraft({
    v: 1, at: now, screen: "screen-secret", mnemonic: "abandon ability", password: PASSWORD,
  });
  assert.equal(secret.flow, "secret");
  assert.equal(secret.mnemonic, undefined);
  assert.equal(secret.password, undefined);
  const change = sanitizePopupDraft({
    v: 1, at: now, screen: "screen-pwchange", pw1: PASSWORD, password: PASSWORD,
  });
  assert.equal(change.flow, "pwchange");
  assert.equal(change.password, undefined);
  assert.equal(change.pw1, undefined);
});

test("broadcast result and transaction detail return, then leave when the page is closed", async () => {
  const statusDrafts = draftStore({
    v: 1, at: Date.now(), screen: "screen-status", flow: "status", status: "broadcast",
    txid: TXID, confirmations: 1, endpoint: "blockbook.example",
  });
  const statusDoc = freshDocument();
  const statusApp = mount(statusDoc, { vault: unlockedVault(), storage: stored(statusDrafts) });
  await statusApp.ready;
  assert.equal(statusDoc.getElementById("screen-status").hidden, false);
  assert.equal(statusDoc.getElementById("statusDetail").textContent, TXID);
  assert.equal(statusDoc.getElementById("statusHost"), null);
  assert.equal(statusDoc.getElementById("statusCard").hidden, false);
  assert.equal(statusDoc.getElementById("viewTx").hidden, false);
  assert.equal(statusDoc.getElementById("bumpConf").hidden, false);
  assert.equal(/Indexer|blockbook\.pearlresearch\.ai/.test(statusDoc.getElementById("screen-status").textContent), false);
  assert.equal(statusDoc.getElementById("viewTx").dataset.url, `https://blockbook.pearlresearch.ai/tx/${TXID}`);
  assert.match(statusDoc.getElementById("statusState").textContent, /Sent/);
  statusDoc.getElementById("statusHome").click();
  assert.equal(await until(() => statusDoc.getElementById("screen-home").hidden === false), true);
  assert.equal(await until(() => statusDrafts.getPopupDraft().then((draft) => draft == null)), true);

  const txDrafts = draftStore({
    v: 1, at: Date.now(), screen: "screen-tx", flow: "tx", txid: TXID, direction: "in",
    amount: "100000000", confirmations: 1, back: "screen-activity",
  });
  const txDoc = freshDocument();
  const txApp = mount(txDoc, { vault: unlockedVault(), storage: stored(txDrafts) });
  await txApp.ready;
  assert.equal(txDoc.getElementById("screen-tx").hidden, false);
  assert.equal(txDoc.getElementById("txId").textContent, TXID);
  assert.equal(txDoc.getElementById("viewTxDetail").hidden, false);
  assert.equal(txDoc.getElementById("viewTxDetail").dataset.url, `https://blockbook.pearlresearch.ai/tx/${TXID}`);
  assert.match(txDoc.getElementById("txAmount").textContent, /1/);
  txDoc.querySelector("#screen-tx [data-back]").click();
  assert.equal(await until(() => txDrafts.getPopupDraft().then((draft) => draft == null)), true);
  assert.equal(txDoc.getElementById("screen-activity").hidden, false);

  const homeDrafts = draftStore({
    v: 1, at: Date.now(), screen: "screen-tx", flow: "tx", txid: TXID, direction: "out",
    amount: "100000000", confirmations: 1, back: "screen-home",
  });
  const homeDoc = freshDocument();
  const homeApp = mount(homeDoc, { vault: unlockedVault(), storage: stored(homeDrafts) });
  await homeApp.ready;
  assert.equal(homeDoc.getElementById("screen-tx").hidden, false);
  homeDoc.querySelector("#screen-tx [data-back]").click();
  assert.equal(await until(() => homeDoc.getElementById("screen-home").hidden === false), true);
  assert.equal(await until(() => homeDoc.getElementById("homeBalance").textContent !== "Loading…"), true);
  assert.notEqual(homeDoc.getElementById("homeFiat").textContent, "Fetching total value…");
  assert.equal(await until(() => homeDrafts.getPopupDraft().then((draft) => draft == null)), true);
});

test("a locked wallet reopens the broadcast result without asking for the password again", async () => {
  const drafts = draftStore({
    v: 1, at: Date.now(), screen: "screen-status", flow: "status", status: "broadcast", txid: TXID.toUpperCase(),
    confirmations: 0,
  });
  const document = freshDocument();
  const app = mount(document, {
    vault: {
      get status() { return { exists: true, unlocked: false, ready: true }; },
      async init() {},
      async address() { return ADDRESS; },
      subscribe() { return () => {}; },
    },
    storage: stored(drafts),
  });
  await app.ready;
  assert.equal(document.getElementById("screen-lock").hidden, true);
  assert.equal(document.getElementById("screen-status").hidden, false);
  assert.equal(document.getElementById("statusDetail").textContent, TXID);
  assert.equal(document.getElementById("viewTx").hidden, false);
  assert.equal(document.getElementById("viewTx").dataset.url, `https://blockbook.pearlresearch.ai/tx/${TXID}`);
  assert.match(document.getElementById("statusState").textContent, /Sent/);
  assert.match(document.getElementById("confText").textContent, /Awaiting confirmation/);
});

test("custom indexer, recovery phrase page, and password change return without secrets", async () => {
  const networkDrafts = draftStore();
  const networkDoc = freshDocument();
  const networkApp = mount(networkDoc, { vault: unlockedVault(), storage: stored(networkDrafts) });
  await networkApp.ready;
  networkDoc.querySelector('#bottomNav [data-tab="screen-settings"]').click();
  networkDoc.getElementById("openNet").click();
  networkDoc.getElementById("netCustomToggle").click();
  networkDoc.getElementById("netHost").value = "127.0.0.1";
  networkDoc.getElementById("netHost").dispatchEvent(new networkDoc.defaultView.Event("input"));
  assert.equal(await until(() => networkDrafts.getPopupDraft().then((draft) => draft?.host === "127.0.0.1")), true);
  const again = freshDocument();
  const againApp = mount(again, { vault: unlockedVault(), storage: stored(networkDrafts) });
  await againApp.ready;
  assert.equal(again.getElementById("screen-network").hidden, false);
  assert.equal(again.getElementById("netCustomFields").hidden, false);
  assert.equal(again.getElementById("netHost").value, "127.0.0.1");
  again.getElementById("netCustomToggle").click();
  assert.equal(await until(() => networkDrafts.getPopupDraft().then((draft) => draft == null)), true);

  const secretDrafts = draftStore();
  const secretDoc = freshDocument();
  const secretApp = mount(secretDoc, { vault: unlockedVault(), storage: stored(secretDrafts) });
  await secretApp.ready;
  secretDoc.querySelector('#bottomNav [data-tab="screen-settings"]').click();
  secretDoc.getElementById("viewSeed").click();
  assert.equal(await until(() => secretDrafts.getPopupDraft().then((draft) => draft?.flow === "secret")), true);
  const savedSecret = await secretDrafts.getPopupDraft();
  assert.equal(savedSecret.mnemonic, undefined);
  assert.equal(savedSecret.password, undefined);
  const secretAgain = freshDocument();
  const secretAgainApp = mount(secretAgain, { vault: unlockedVault(), storage: stored(secretDrafts) });
  await secretAgainApp.ready;
  assert.equal(secretAgain.getElementById("screen-secret").hidden, false);
  assert.equal(secretAgain.getElementById("seedGate").hidden, false);
  assert.equal(secretAgain.getElementById("seedGrid").hidden, true);
  assert.equal(secretAgain.getElementById("seedGrid").textContent, "");

  const changeDrafts = draftStore();
  const changeDoc = freshDocument();
  const changeApp = mount(changeDoc, { vault: unlockedVault(), storage: stored(changeDrafts) });
  await changeApp.ready;
  changeDoc.querySelector('#bottomNav [data-tab="screen-settings"]').click();
  changeDoc.getElementById("openPw").click();
  changeDoc.getElementById("oldPw").value = PASSWORD;
  changeDoc.getElementById("newPw").value = "next-password";
  assert.equal(await until(() => changeDrafts.getPopupDraft().then((draft) => draft?.flow === "pwchange")), true);
  const savedChange = await changeDrafts.getPopupDraft();
  assert.equal(savedChange.password, undefined);
  assert.equal(JSON.stringify(savedChange).includes(PASSWORD), false);
  const changeAgain = freshDocument();
  const changeAgainApp = mount(changeAgain, { vault: unlockedVault(), storage: stored(changeDrafts) });
  await changeAgainApp.ready;
  assert.equal(changeAgain.getElementById("screen-pwchange").hidden, false);
  assert.equal(changeAgain.getElementById("oldPw").value, "");
  assert.equal(changeAgain.getElementById("newPw").value, "");
  assert.equal(changeAgain.getElementById("newPw2").value, "");
});

test("view-transaction links follow the network the transaction was sent on", async () => {
  assert.equal(explorerTxUrl("Pearl mainnet", TXID), `https://blockbook.pearlresearch.ai/tx/${TXID}`);
  assert.equal(explorerTxUrl("Pearl testnet", TXID), `https://blockbook.testnet2.pearlnetwork.net/tx/${TXID}`);
  assert.equal(explorerTxUrl("Pearl regtest", TXID), "");
  assert.equal(explorerTxUrl("Pearl testnet", "zz"), "");

  const statusDrafts = draftStore({
    v: 1, at: Date.now(), screen: "screen-status", flow: "status", status: "broadcast",
    txid: TXID, confirmations: 0, network: "Pearl testnet",
  });
  const statusDoc = freshDocument();
  const statusApp = mount(statusDoc, { vault: unlockedVault(), storage: stored(statusDrafts) });
  await statusApp.ready;
  assert.equal(statusDoc.getElementById("viewTx").dataset.url, `https://blockbook.testnet2.pearlnetwork.net/tx/${TXID}`);

  const txDrafts = draftStore({
    v: 1, at: Date.now(), screen: "screen-tx", flow: "tx", txid: TXID, direction: "out",
    amount: "100000000", confirmations: 1, back: "screen-activity", network: "Pearl testnet",
  });
  const txDoc = freshDocument();
  const txApp = mount(txDoc, { vault: unlockedVault(), storage: stored(txDrafts) });
  await txApp.ready;
  assert.equal(txDoc.getElementById("viewTxDetail").dataset.url, `https://blockbook.testnet2.pearlnetwork.net/tx/${TXID}`);
});
