import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseHTML } from "linkedom";
import { mountShell } from "../src/shell.js";

const ADDRESS = "prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4na";
const CHANGE = "prl1pglwzxm30w89uhqqxj8x4phpf8c2jgl3x6kzdhj3m2hcy9d2fe7lqxn53yc";

function mount(document, {
  vault, storage, fetchAddress, fetchUtxos, mainnetStore, fetchPearlUsdSpot,
  networkPrefs, applyNetworkPrefs, estimateFees,
}) {
  return mountShell(document, {
    vault,
    storage,
    fetchAddress,
    fetchUtxos: fetchUtxos || (async () => []),
    broadcaster: {},
    mainnetStore: mainnetStore || null,
    fetchPearlUsdSpot: fetchPearlUsdSpot || null,
    networkPrefs,
    applyNetworkPrefs,
    estimateFees,
    async copyText() {},
    async drawQr() {},
  });
}

async function until(predicate, attempts = 80) {
  for (let i = 0; i < attempts && !predicate(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("home fiat stays on loading until price resolves, never flashes no-quote", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let releasePrice;
  const priceReady = new Promise((resolve) => { releasePrice = resolve; });
  const seenFiat = [];
  const app = mount(document, {
    vault: {
      get status() { return { exists: false, unlocked: false, ready: true }; },
      async init() {},
      subscribe() { return () => {}; },
    },
    storage: {
      async getVault() { return null; },
      async getBook() {
        return { current: "w1", items: [{ id: "w1", name: "观察地址", kind: "watch", address: ADDRESS }] };
      },
      async setBook() {},
    },
    async fetchAddress() {
      return { balance: 125000000n, activity: [] };
    },
    async fetchPearlUsdSpot() {
      await priceReady;
      return { amount: "2", scaled: 2n, scale: 0, source: "coinbase" };
    },
  });
  const fiat = document.getElementById("homeFiat");
  const sample = setInterval(() => { seenFiat.push(fiat.textContent); }, 5);
  await app.ready;
  await until(() => document.getElementById("homeBalance").textContent === "1.25");
  assert.equal(fiat.textContent, "Fetching total value…");
  assert.ok(!seenFiat.includes("No USD quote yet"));
  assert.ok(!seenFiat.includes("总价值暂无报价"));
  releasePrice();
  await until(() => fiat.textContent === "$2.50");
  clearInterval(sample);
  assert.ok(!seenFiat.includes("No USD quote yet"));
  assert.ok(!seenFiat.includes("总价值暂无报价"));
  assert.equal(fiat.textContent, "$2.50");
});

test("a watch-only book reopens on home and hiding the balance does not query again", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let queries = 0;
  let priceQueries = 0;
  const app = mount(document, {
    vault: {
      get status() { return { exists: false, unlocked: false, ready: true }; },
      async init() {},
      subscribe() { return () => {}; },
    },
    storage: {
      async getVault() { return null; },
      async getBook() {
        return { current: "w1", items: [{ id: "w1", name: "观察地址", kind: "watch", address: ADDRESS }] };
      },
      async setBook() {},
    },
    async fetchAddress() {
      queries += 1;
      return { balance: 125000000n, activity: [] };
    },
    async fetchPearlUsdSpot() {
      priceQueries += 1;
      return { amount: "2", scaled: 2n, scale: 0, source: "coinbase" };
    },
  });
  await app.ready;
  for (let i = 0; i < 40 && document.getElementById("homeBalance").textContent === "Loading…"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await until(() => document.getElementById("homeFiat").textContent === "$2.50");
  assert.equal(document.getElementById("screen-home").hidden, false);
  assert.equal(document.getElementById("screen-welcome").hidden, true);
  assert.equal(document.getElementById("homeBalance").textContent, "1.25");
  assert.equal(document.getElementById("homeFiat").hidden, false);
  assert.equal(document.getElementById("homeFiat").textContent, "$2.50");
  assert.match(document.getElementById("homeSpot").textContent, /Spot \$2\.00 · Coinbase/);
  assert.equal(document.getElementById("goSend").disabled, true);
  assert.equal(document.getElementById("accountKind").hidden, false);
  assert.equal(document.getElementById("accountKind").textContent, "Watch");
  assert.equal(document.getElementById("sendLimit").hidden, false);
  assert.equal(document.querySelector('#bottomNav button[data-tab="screen-home"]').getAttribute("aria-current"), "page");
  const seen = queries;
  const prices = priceQueries;
  document.getElementById("hideBalance").click();
  assert.equal(document.getElementById("homeBalance").textContent, "••••");
  assert.equal(document.getElementById("homeFiat").textContent, "••••");
  assert.equal(document.getElementById("homeSpot").textContent, "••••");
  assert.equal(document.getElementById("hideBalance").getAttribute("aria-pressed"), "true");
  assert.equal(queries, seen);
  assert.equal(priceQueries, prices);
  document.getElementById("hideBalance").click();
  assert.equal(document.getElementById("homeBalance").textContent, "1.25");
  assert.equal(document.getElementById("homeFiat").textContent, "$2.50");
  assert.equal(queries, seen);
});

test("home activity and send share change-address balance from one wallet snapshot", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = true;
  const queried = [];
  const utxoAddresses = [];
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const app = mount(document, {
      vault: {
        get status() { return { exists: true, unlocked, ready: true }; },
        async init() {},
        lock() { unlocked = false; },
        async address(branch, index) {
          if (branch === 0 && index === 0) return ADDRESS;
          if (branch === 1 && index === 0) return CHANGE;
          return `${ADDRESS}-${branch}-${index}`;
        },
        subscribe() { return () => {}; },
      },
      storage: {
        async getVault() { return { version: 2 }; },
        async getBook() {
          return {
            current: "d0",
            items: [{
              id: "d0", name: "账户 1", kind: "derived", account: 0,
              address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
            }],
          };
        },
        async setBook() {},
        async getMeta() {
          return { homeScan: { d0: [ADDRESS, CHANGE] }, cursors: { d0: { receiveNext: 0, changeNext: 0 } } };
        },
        async setMeta() {},
        async getIdle() { return null; },
      },
      mainnetStore: {
        async getLatestSpendHintForAddress() {
          return {
            txid: "11".repeat(32),
            payment: "200000000",
            fee: "400",
            sourceAddress: ADDRESS,
            changeAddress: CHANGE,
          };
        },
        async getLatestAddressGroupForAddress() { return [ADDRESS, CHANGE]; },
      },
      async fetchAddress(address) {
        queried.push(address);
        if (address === CHANGE) {
          return {
            balance: 199139538n,
            activity: [{
              txid: "11".repeat(32), direction: "in", amount: 199139538n, confirmations: 2, time: 1_700_000_000,
            }],
          };
        }
        if (address === ADDRESS) {
          return {
            balance: 0n,
            activity: [{
              txid: "11".repeat(32), direction: "out", amount: 399139846n, confirmations: 2, time: 1_700_000_000,
            }],
          };
        }
        return { balance: 0n, activity: [] };
      },
      async fetchUtxos(address) {
        utxoAddresses.push(address);
        if (address !== CHANGE) return [];
        return [{
          txid: "22".repeat(32),
          vout: 1,
          value: "199139538",
          confirmations: 2,
          prevTxHex: "00",
        }];
      },
    });
    await app.ready;
    await until(() => document.getElementById("homeBalance").textContent === "1.9914");
    assert.equal(document.getElementById("homeBalance").textContent, "1.9914");
    assert.equal(queried.includes(CHANGE), true);
    assert.match(document.getElementById("homeTx").textContent, /−2/);
    assert.match(document.getElementById("homeTx").textContent, /PEARL/);
    assert.match(document.getElementById("homeTx").textContent, /Confirmed|已确认/);

    document.getElementById("homeActivityAll").click();
    await until(() => document.getElementById("screen-activity").hidden === false);
    assert.match(document.getElementById("activityList").textContent, /−2/);
    assert.match(document.getElementById("activityList").textContent, /PEARL/);

    document.getElementById("goSend").click();
    await until(() => document.getElementById("screen-send").hidden === false);
    await until(() => document.getElementById("availLine").textContent.includes("1.99139538"));
    assert.match(document.getElementById("availLine").textContent, /1\.99139538/);
    const customRate = document.getElementById("customRate");
    const customEst = document.getElementById("customFeeEst");
    assert.equal(customEst.hidden, true);
    customRate.value = "100";
    customRate.dispatchEvent(new document.defaultView.Event("input"));
    assert.equal(customEst.hidden, false);
    assert.equal(customEst.textContent, "≈ 0.00018 PEARL");
    assert.equal(document.getElementById("fee-fast").getAttribute("aria-checked"), "false");
    customRate.value = "";
    customRate.dispatchEvent(new document.defaultView.Event("input"));
    assert.equal(customEst.hidden, true);
    assert.equal(document.getElementById("fee-fast").getAttribute("aria-checked"), "true");
  } finally {
    globalThis.document = previous;
  }
});

test("home reuses cached balance while refreshing in the background", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let queries = 0;
  let release;
  let gate = null;
  const app = mount(document, {
    vault: {
      get status() { return { exists: false, unlocked: false, ready: true }; },
      async init() {},
      subscribe() { return () => {}; },
    },
    storage: {
      async getVault() { return null; },
      async getBook() {
        return { current: "w1", items: [{ id: "w1", name: "观察地址", kind: "watch", address: ADDRESS }] };
      },
      async setBook() {},
    },
    async fetchAddress() {
      queries += 1;
      if (gate) await gate;
      return { balance: 125000000n, activity: [] };
    },
  });
  await app.ready;
  for (let i = 0; i < 40 && document.getElementById("homeBalance").textContent === "Loading…"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(document.getElementById("homeBalance").textContent, "1.25");
  const first = queries;
  gate = new Promise((resolve) => { release = resolve; });
  document.querySelector('#bottomNav button[data-tab="screen-home"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById("homeBalance").textContent, "1.25");
  assert.equal(document.getElementById("balanceCard").classList.contains("soft-refresh"), true);
  release();
  for (let i = 0; i < 40 && document.getElementById("balanceCard").classList.contains("soft-refresh"); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(document.getElementById("homeBalance").textContent, "1.25");
  assert.equal(queries > first, true);
});

test("password change stays on the page until the new password is repeated", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = false;
  let changed = 0;
  const app = mount(document, {
    vault: {
      get status() { return { exists: true, unlocked, ready: true }; },
      async init() {},
      async unlock() { unlocked = true; },
      lock() { unlocked = false; },
      address() { return ADDRESS; },
      async changePassword() { changed += 1; },
      subscribe() { return () => {}; },
    },
    storage: {
      async getVault() { return { version: 2 }; },
      async setVault() {},
      async getBook() { return null; },
      async setBook() {},
      async getIdle() { return null; },
    },
    async fetchAddress() { return { balance: 0n, activity: [] }; },
  });
  await app.ready;
  document.getElementById("lockPw").value = "public-test-password-123";
  document.getElementById("lockUnlock").click();
  for (let i = 0; i < 40 && document.getElementById("screen-home").hidden; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  document.querySelector('#bottomNav button[data-tab="screen-settings"]').click();
  document.getElementById("openPw").click();
  document.getElementById("oldPw").value = "public-test-password-123";
  document.getElementById("newPw").value = "12345678";
  document.getElementById("newPw2").value = "12345678";
  document.getElementById("changePw").click();
  assert.match(document.getElementById("pwChangeError").textContent, /only letters or only numbers/);
  assert.equal(changed, 0);
  document.getElementById("newPw").value = "another-public-password";
  document.getElementById("newPw2").value = "different-public-password";
  document.getElementById("changePw").click();
  assert.match(document.getElementById("pwChangeError").textContent, /do not match|不一致/);
  assert.equal(document.getElementById("newPw2").getAttribute("aria-invalid"), "true");
  assert.equal(changed, 0);
  assert.equal(document.getElementById("screen-pwchange").hidden, false);

  document.getElementById("newPw2").value = "another-public-password";
  const enter = new document.defaultView.Event("keydown", { bubbles: true, cancelable: true });
  enter.key = "Enter";
  document.getElementById("newPw2").dispatchEvent(enter);
  for (let i = 0; i < 20 && document.getElementById("screen-settings").hidden; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(changed, 1);
  assert.equal(document.getElementById("screen-settings").hidden, false);
  assert.equal(document.getElementById("newPw").value, "");
  assert.equal(document.getElementById("newPw2").value, "");
});

test("receive uses fresh home cursors without rescanning", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  const pending = [];
  let unlocked = true;
  let block = false;
  let queries = 0;
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const app = mount(document, {
      vault: {
        get status() { return { exists: true, unlocked, ready: true }; },
        async init() {},
        lock() { unlocked = false; },
        async address(_branch, _index) { return ADDRESS; },
        subscribe() { return () => {}; },
      },
      storage: {
        async getVault() { return { version: 2 }; },
        async getBook() {
          return {
            current: "d0",
            items: [{
              id: "d0", name: "账户 1", kind: "derived", account: 0,
              address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
            }],
          };
        },
        async setBook() {},
        async getIdle() { return null; },
      },
      async fetchAddress() {
        queries += 1;
        if (!block) return { balance: 0n, activity: [] };
        return new Promise((resolve) => pending.push(resolve));
      },
    });
    await app.ready;
    for (let i = 0; i < 80 && document.getElementById("homeBalance").textContent === "Loading…"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const seen = queries;
    block = true;
    document.getElementById("goReceive").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.getElementById("screen-receive").hidden, false);
    assert.equal(document.getElementById("screen-home").hidden, true);
    assert.match(document.getElementById("recvAddr").textContent, /prl1/);
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(pending.length, 0);
    assert.equal(queries, seen);
  } finally {
    for (const resolve of pending) resolve({ balance: 0n, activity: [] });
    globalThis.document = previous;
  }
});

test("temporary receive skips locally cached used addresses without waiting on indexer", async () => {
  const FIRST = ADDRESS;
  const SECOND = "prl1p3g3gq6f2mzke7f2vru90ep9erp9e6sgumrxw8akytd45s2zzctwsacrerl";
  const THIRD = "prl1pegrplgs2f4d8e4qv425c946rtpg0dszjmuuahx5q4uw6tsdfysnqmufc97";
  const byIndex = [FIRST, SECOND, THIRD];
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = true;
  let book = {
    current: "d0",
    items: [{
      id: "d0", name: "账户 1", kind: "derived", account: 0,
      address: FIRST, receiveIndex: 1, changeIndex: 0, gapLimit: 2,
    }],
  };
  let meta = { usedReceive: { "Pearl mainnet": { d0: [SECOND] } } };
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const app = mount(document, {
      vault: {
        get status() { return { exists: true, unlocked, ready: true }; },
        async init() {},
        lock() { unlocked = false; },
        async address(_branch, index) { return byIndex[index] || byIndex[byIndex.length - 1]; },
        subscribe() { return () => {}; },
      },
      storage: {
        async getVault() { return { version: 2 }; },
        async getBook() { return structuredClone(book); },
        async setBook(next) { book = structuredClone(next); },
        async getIdle() { return null; },
        async getMeta() { return structuredClone(meta); },
        async setMeta(next) { meta = structuredClone(next); },
      },
      async fetchAddress() { return { balance: 0n, txCount: 0, activity: [] }; },
    });
    await app.ready;
    await until(() => !document.getElementById("screen-home").hidden);

    document.getElementById("goReceive").click();
    await until(() => !document.getElementById("screen-receive").hidden);
    document.getElementById("newRecv").click();
    await until(() => document.getElementById("recvAddr").textContent.includes("fc97"));
    assert.match(document.getElementById("recvAddr").textContent, /fc97/);
    assert.equal(document.getElementById("recvAddr").textContent.includes("rerl"), false);
    assert.ok(book.items[0].receiveIndex >= 2);
    await app.ready.catch(() => {});
  } finally {
    globalThis.document = previous;
  }
});

test("chain scan temporary receive errors when the unused window is saturated", async () => {
  const FIRST = ADDRESS;
  const byIndex = Array.from({ length: 40 }, (_, i) => `${FIRST.slice(0, -4)}${String(i).padStart(4, "0")}`);
  byIndex[0] = FIRST;
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = true;
  let book = {
    current: "d0",
    items: [{
      id: "d0", name: "账户 1", kind: "derived", account: 0,
      address: FIRST, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
    }],
  };
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const app = mount(document, {
      vault: {
        get status() { return { exists: true, unlocked, ready: true }; },
        async init() {},
        lock() { unlocked = false; },
        async address(_branch, index) { return byIndex[index] || `prl1pused${index}`; },
        subscribe() { return () => {}; },
      },
      storage: {
        async getVault() { return { version: 2 }; },
        async getBook() { return structuredClone(book); },
        async setBook(next) { book = structuredClone(next); },
        async getIdle() { return null; },
        async getMeta() { return {}; },
        async setMeta() {},
      },
      async fetchAddress() { return { balance: 1n, txCount: 1, activity: [] }; },
    });
    await app.ready;
    await until(() => !document.getElementById("screen-home").hidden);
    document.getElementById("goReceive").click();
    await until(() => !document.getElementById("screen-receive").hidden);
    document.getElementById("newRecvScan").click();
    await until(() => document.getElementById("qr-error").textContent.length > 0, 200);
    assert.match(document.getElementById("qr-error").textContent, /未使用|unused|scan window|扫描窗口/i);
    await app.ready.catch(() => {});
  } finally {
    globalThis.document = previous;
  }
});

test("send fee cards use block targets and paint selected rate while snapshot loads", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = true;
  let holdSnapshot = false;
  let releaseSnapshot;
  let snapshotGate = Promise.resolve();
  let feeCalls = 0;
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const app = mount(document, {
      vault: {
        get status() { return { exists: true, unlocked, ready: true }; },
        async init() {},
        lock() { unlocked = false; },
        async address() { return ADDRESS; },
        subscribe() { return () => {}; },
      },
      storage: {
        async getVault() { return { version: 2 }; },
        async getBook() {
          return {
            current: "d0",
            items: [{
              id: "d0", name: "账户 1", kind: "derived", account: 0,
              address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
            }],
          };
        },
        async setBook() {},
        async getIdle() { return null; },
        async getMeta() { return {}; },
        async setMeta() {},
      },
      async fetchAddress() {
        if (holdSnapshot) await snapshotGate;
        return { balance: 2_644_204_300n, txCount: 1, activity: [] };
      },
      async estimateFees() {
        feeCalls += 1;
        return { menu: { slow: 1, standard: 2, fast: 50 }, fallback: false };
      },
    });
    await app.ready;
    await until(() => !document.getElementById("screen-home").hidden);
    holdSnapshot = true;
    snapshotGate = new Promise((resolve) => { releaseSnapshot = resolve; });
    document.getElementById("goSend").click();
    await until(() => !document.getElementById("screen-send").hidden);
    await until(() => /50 grain\/vB/.test(document.getElementById("feeSelected").textContent || ""));
    assert.ok(feeCalls >= 1);
    assert.equal(document.getElementById("fee-fast").getAttribute("aria-checked"), "true");
    assert.match(document.getElementById("fee-fast").textContent, /1 block|1 块/);
    assert.match(document.getElementById("fee-standard").textContent, /10/);
    assert.match(document.getElementById("fee-slow").textContent, /25/);
    assert.equal(document.querySelector(".fees").classList.contains("is-loading"), false);
    // Fees must finish even while the send-page snapshot refresh is still gated.
    assert.equal(holdSnapshot, true);
    releaseSnapshot();
    await until(() => document.getElementById("availLine").textContent.includes("26.442043"));
    await app.ready.catch(() => {});
  } finally {
    globalThis.document = previous;
  }
});

test("settings account preview lists all accounts and drills into structure", async () => {
  const FIRST = ADDRESS;
  const SECOND = "prl1p3g3gq6f2mzke7f2vru90ep9erp9e6sgumrxw8akytd45s2zzctwsacrerl";
  const CHANGE0 = "prl1pegrplgs2f4d8e4qv425c946rtpg0dszjmuuahx5q4uw6tsdfysnqmufc97";
  const OTHER = "prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4na";
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = true;
  let book = {
    current: "d0",
    items: [
      {
        id: "d0", name: "账户 1", kind: "derived", account: 0,
        address: FIRST, receiveIndex: 1, changeIndex: 0, gapLimit: 2,
      },
      {
        id: "d1", name: "账户 2", kind: "derived", account: 1,
        address: OTHER, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
      },
      { id: "w1", name: "观察地址", kind: "watch", address: OTHER },
    ],
  };
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const app = mount(document, {
      vault: {
        get status() { return { exists: true, unlocked, ready: true }; },
        async init() {},
        lock() { unlocked = false; },
        async address(branch, index, account = 0) {
          if (account === 1) return OTHER;
          if (branch === 1) return CHANGE0;
          return index === 0 ? FIRST : SECOND;
        },
        subscribe() { return () => {}; },
      },
      storage: {
        async getVault() { return { version: 2 }; },
        async getBook() { return structuredClone(book); },
        async setBook(next) { book = structuredClone(next); },
        async getIdle() { return null; },
        async getMeta() { return {}; },
        async setMeta() {},
      },
      async fetchAddress() { return { balance: 0n, txCount: 0, activity: [] }; },
    });
    await app.ready;
    await until(() => !document.getElementById("screen-home").hidden);
    document.querySelector('#bottomNav button[data-tab="screen-settings"]').click();
    await until(() => !document.getElementById("screen-settings").hidden);
    assert.ok(document.getElementById("openAccountsPreview"));
    assert.equal(document.getElementById("openStructure"), null);
    document.getElementById("openAccountsPreview").click();
    await until(() => !document.getElementById("screen-accounts-preview").hidden);
    await until(() => document.getElementById("accountsPreviewList").children.length === 2);
    assert.equal(document.getElementById("accountsPreviewList").children.length, 2);
    assert.match(document.getElementById("accountsPreviewList").textContent, /账户 1/);
    assert.match(document.getElementById("accountsPreviewList").textContent, /账户 2/);
    assert.equal(document.getElementById("accountsPreviewList").textContent.includes("观察"), false);

    document.querySelector("#accountsPreviewList .addr-row-main").click();
    await until(() => !document.getElementById("screen-structure").hidden);
    await until(() => document.getElementById("structureReceiveList").children.length >= 2);
    assert.equal(document.getElementById("structureAccountName").textContent, "账户 1");
    assert.equal(document.getElementById("structureReceiveList").children.length, 2);
    assert.equal(document.getElementById("structureChangeList").children.length, 1);
    assert.match(document.getElementById("structureChangeList").textContent, /Change #0|找零 #0/);
    assert.equal(document.getElementById("structureScan").hidden, false);
    assert.equal(document.querySelector("#screen-structure [data-back]").dataset.back, "screen-accounts-preview");

    document.querySelector("#screen-structure [data-back]").click();
    await until(() => !document.getElementById("screen-accounts-preview").hidden);
    document.querySelectorAll("#accountsPreviewList .addr-row-main")[1].click();
    await until(() => document.getElementById("structureAccountName").textContent === "账户 2");
    await until(() => document.getElementById("structureReceiveList").children.length >= 1);
    assert.equal(document.getElementById("structureReceiveList").children.length, 1);
    await app.ready.catch(() => {});
  } finally {
    globalThis.document = previous;
  }
});

test("settings lists known receive addresses and Receive can pick one temporarily", async () => {
  const FIRST = ADDRESS;
  const SECOND = "prl1p3g3gq6f2mzke7f2vru90ep9erp9e6sgumrxw8akytd45s2zzctwsacrerl";
  const byIndex = [FIRST, SECOND];
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = true;
  let book = {
    current: "d0",
    items: [{
      id: "d0", name: "账户 1", kind: "derived", account: 0,
      address: FIRST, receiveIndex: 1, changeIndex: 0, gapLimit: 2,
    }],
  };
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const app = mount(document, {
      vault: {
        get status() { return { exists: true, unlocked, ready: true }; },
        async init() {},
        lock() { unlocked = false; },
        async address(_branch, index) { return byIndex[index] || byIndex[byIndex.length - 1]; },
        subscribe() { return () => {}; },
      },
      storage: {
        async getVault() { return { version: 2 }; },
        async getBook() { return structuredClone(book); },
        async setBook(next) { book = structuredClone(next); },
        async getIdle() { return null; },
        async getMeta() { return {}; },
        async setMeta() {},
      },
      async fetchAddress() { return { balance: 0n, txCount: 0, activity: [] }; },
    });
    await app.ready;
    await until(() => !document.getElementById("screen-home").hidden);

    document.querySelector('#bottomNav button[data-tab="screen-settings"]').click();
    await until(() => !document.getElementById("screen-settings").hidden);
    document.getElementById("openAddresses").click();
    await until(() => !document.getElementById("screen-addresses").hidden);
    await until(() => document.getElementById("addressManageList").children.length >= 2);
    assert.equal(document.getElementById("addressManageList").children.length, 2);

    document.querySelector('#bottomNav button[data-tab="screen-home"]').click();
    await until(() => !document.getElementById("screen-home").hidden);
    document.getElementById("goReceive").click();
    await until(() => !document.getElementById("screen-receive").hidden);
    document.getElementById("pickRecv").click();
    await until(() => !document.getElementById("recvPickSheet").hidden);
    const pickButtons = [...document.querySelectorAll("#recvPickList .addr-row-main")];
    assert.equal(pickButtons.length, 2);
    pickButtons[1].click();
    await until(() => document.getElementById("recvAddr").textContent.includes("rerl"));
    assert.match(document.getElementById("recvAddr").textContent, /rerl/);
    assert.equal(document.getElementById("recvTempHint").hidden, false);
    assert.match(document.getElementById("recvTempHint").textContent, /Temporary chosen|已选用/);
    await until(() => /Temporary address selected|已选用临时地址/.test(document.getElementById("toast").textContent));
    assert.match(document.getElementById("toast").textContent, /Temporary address selected|已选用临时地址/);

    document.querySelector('#bottomNav button[data-tab="screen-home"]').click();
    await until(() => document.getElementById("homeAddr").textContent === FIRST);
    assert.equal(document.getElementById("homeAddr").textContent, FIRST);
    await app.ready.catch(() => {});
  } finally {
    globalThis.document = previous;
  }
});

test("Receive stays on the first address; new address is temporary only", async () => {
  const FIRST = ADDRESS;
  const SECOND = "prl1p3g3gq6f2mzke7f2vru90ep9erp9e6sgumrxw8akytd45s2zzctwsacrerl";
  const THIRD = "prl1pegrplgs2f4d8e4qv425c946rtpg0dszjmuuahx5q4uw6tsdfysnqmufc97";
  const byIndex = [FIRST, SECOND, THIRD];
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = true;
  let book = {
    current: "d0",
    items: [{
      id: "d0", name: "账户 1", kind: "derived", account: 0,
      address: FIRST, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
    }],
  };
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const app = mount(document, {
      vault: {
        get status() { return { exists: true, unlocked, ready: true }; },
        async init() {},
        lock() { unlocked = false; },
        async address(_branch, index) { return byIndex[index] || byIndex[byIndex.length - 1]; },
        subscribe() { return () => {}; },
      },
      storage: {
        async getVault() { return { version: 2 }; },
        async getBook() { return structuredClone(book); },
        async setBook(next) { book = structuredClone(next); },
        async getIdle() { return null; },
      },
      async fetchAddress() { return { balance: 0n, txCount: 0, activity: [] }; },
    });
    await app.ready;
    await until(() => !document.getElementById("screen-home").hidden);

    document.getElementById("goReceive").click();
    await until(() => !document.getElementById("screen-receive").hidden);
    await until(() => document.getElementById("recvAddr").textContent.includes("sm7r4na"));
    assert.match(document.getElementById("recvAddr").textContent, /sm7r4na/);
    assert.equal(document.getElementById("recvTools").hidden, false);
    assert.equal(document.getElementById("newRecv").hidden, false);
    assert.equal(document.getElementById("newRecvScan").hidden, false);
    assert.equal(document.getElementById("recvTempHint").hidden, true);

    document.getElementById("newRecv").click();
    await until(() => document.getElementById("recvAddr").textContent.includes("rerl"));
    assert.match(document.getElementById("recvAddr").textContent, /rerl/);
    assert.equal(document.getElementById("recvTempHint").hidden, false);
    assert.match(document.getElementById("toast").textContent, /Temporary address ready \(local\)|已显示临时地址（本地）/);
    assert.match(document.getElementById("recvTempHint").textContent, /local cache|本地缓存/);
    assert.equal(book.items[0].receiveIndex, 1);

    document.getElementById("newRecv").click();
    await until(() => document.getElementById("recvAddr").textContent.includes("fc97"));
    assert.match(document.getElementById("recvAddr").textContent, /fc97/);
    assert.equal(book.items[0].receiveIndex, 2);

    document.querySelector('#bottomNav button[data-tab="screen-home"]')?.click();
    await until(() => !document.getElementById("screen-home").hidden);
    await until(() => document.getElementById("homeAddr").textContent === FIRST);
    assert.equal(document.getElementById("homeAddr").textContent, FIRST);
    assert.equal(document.getElementById("switchAddr").textContent, `${FIRST.slice(0, 6)}…${FIRST.slice(-4)}`);

    document.getElementById("goReceive").click();
    await until(() => document.getElementById("recvAddr").textContent.includes("sm7r4na"));
    assert.match(document.getElementById("recvAddr").textContent, /sm7r4na/);
    assert.equal(document.getElementById("recvTempHint").hidden, true);
    await app.ready.catch(() => {});
  } finally {
    globalThis.document = previous;
  }
});

test("watch addresses stay in the local book and never require vault password", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = true;
  let book = {
    current: "d0",
    items: [{
      id: "d0", name: "账户 1", kind: "derived", account: 0,
      address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
    }],
  };
  let noted = null;
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const app = mount(document, {
      vault: {
        get status() { return { exists: true, unlocked, ready: true }; },
        async init() {},
        lock() { unlocked = false; },
        async unlock() { unlocked = true; },
        async address() { return ADDRESS; },
        async projectedBook(current = null) {
          return {
            current: current || "d0",
            items: book.items.filter((item) => item.kind !== "watch").map((item) => ({ ...item })),
          };
        },
        async directory() { return { schemaVersion: 2, accounts: [], watch: [] }; },
        async noteBook(next) { noted = next; },
        subscribe() { return () => {}; },
      },
      storage: {
        async getVault() { return { version: 2 }; },
        async getBook() { return book; },
        async setBook(next) { book = next; },
        async getIdle() { return null; },
      },
      async fetchAddress() { return { balance: 0n, activity: [] }; },
    });
    await app.ready;
    document.getElementById("accountSwitch").click();
    document.getElementById("addMenuWatch").click();
    await until(() => !document.getElementById("screen-watch").hidden);
    document.getElementById("watchInput").value = ADDRESS;
    document.getElementById("saveWatch").click();
    await until(() => book.items.some((item) => item.kind === "watch"));
    assert.equal(document.getElementById("screen-account-pw").hidden, true);
    assert.ok(book.items.some((item) => item.kind === "watch" && item.address === ADDRESS));
    assert.ok(noted?.items.some((item) => item.kind === "watch"));
  } finally {
    globalThis.document = previous;
  }
});

test("account sheet rename stays open while editing and only saves on blur with a change", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let book = {
    current: "d0",
    items: [{
      id: "d0", name: "Account 1", kind: "derived", account: 0,
      address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
    }],
  };
  let saves = 0;
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const app = mount(document, {
      vault: {
        get status() { return { exists: true, unlocked: true, ready: true }; },
        async init() {},
        async address() { return ADDRESS; },
        subscribe() { return () => {}; },
      },
      storage: {
        async getVault() { return { version: 2 }; },
        async getBook() { return book; },
        async setBook(next) { saves += 1; book = next; },
        async getIdle() { return null; },
      },
      async fetchAddress() { return { balance: 0n, activity: [] }; },
    });
    await app.ready;
    document.getElementById("accountSwitch").click();
    const rename = document.querySelector('[aria-label="Rename"]');
    assert.ok(rename);
    const beforeSaves = saves;
    rename.click();
    const input = document.querySelector("#accountList .name-edit");
    assert.ok(input);
    assert.equal(document.querySelector("#accountList .acct-main").hidden, true);
    input.dispatchEvent(new document.defaultView.Event("click", { bubbles: true }));
    input.value = "Account 123456778";
    assert.equal(book.items[0].name, "Account 1");
    assert.equal(saves, beforeSaves);
    input.dispatchEvent(new document.defaultView.Event("blur", { bubbles: true }));
    for (let i = 0; i < 50 && (book.items[0].name !== "Account 123456778" || document.querySelector("#accountList .name-edit")); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(book.items[0].name, "Account 123456778");
    assert.ok(saves > beforeSaves);
    assert.equal(document.querySelector("#accountList .name-edit"), null);
    assert.equal(document.getElementById("switchName").textContent, "Account 123456778");
  } finally {
    globalThis.document = previous;
  }
});

test("account sheet can remove a watch address after confirm tap", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = true;
  let book = {
    current: "w1",
    items: [
      {
        id: "d0", name: "账户 1", kind: "derived", account: 0,
        address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
      },
      { id: "w1", name: "观察地址", kind: "watch", address: ADDRESS },
    ],
  };
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const app = mount(document, {
      vault: {
        get status() { return { exists: true, unlocked, ready: true }; },
        async init() {},
        lock() { unlocked = false; },
        async unlock() { unlocked = true; },
        async address() { return ADDRESS; },
        async noteBook(next) { book = next; },
        subscribe() { return () => {}; },
      },
      storage: {
        async getVault() { return { version: 2 }; },
        async getBook() { return book; },
        async setBook(next) { book = next; },
        async getIdle() { return null; },
      },
      async fetchAddress() { return { balance: 0n, activity: [] }; },
    });
    await app.ready;
    document.getElementById("accountSwitch").click();
    const remove = document.querySelector('[aria-label="Remove watch address"]');
    assert.ok(remove);
    remove.click();
    assert.equal(book.items.some((item) => item.id === "w1"), true);
    remove.click();
    for (let i = 0; i < 20 && book.items.some((item) => item.id === "w1"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(book.items.some((item) => item.id === "w1"), false);
    assert.equal(book.current, "d0");
    for (let i = 0; i < 40 && document.getElementById("switchName").textContent !== "账户 1"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(document.getElementById("switchName").textContent, "账户 1");
    assert.equal(document.querySelector('[aria-label="Remove watch address"]'), null);
  } finally {
    globalThis.document = previous;
  }
});

test("account sheet watch-only opens without private-key import", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = true;
  const previous = globalThis.document;
  globalThis.document = document;
  try {
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
        async getVault() { return { version: 2 }; },
        async getBook() {
          return {
            current: "d0",
            items: [{
              id: "d0", name: "账户 1", kind: "derived", account: 0,
              address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
            }],
          };
        },
        async setBook() {},
        async getIdle() { return null; },
      },
      async fetchAddress() { return { balance: 0n, activity: [] }; },
    });
    await app.ready;
    assert.equal(document.getElementById("addMenuImport"), null);
    assert.equal(document.getElementById("chooseKey"), null);
    document.getElementById("accountSwitch").click();
    document.getElementById("addMenuWatch").click();
    assert.equal(document.getElementById("screen-watch").hidden, false);
    assert.equal(document.getElementById("screen-watch").querySelector("[data-back]").dataset.back, "screen-home");
  } finally {
    globalThis.document = previous;
  }
});

test("viewing seed while unlocked verifies password instead of failing unlock", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let unlocked = true;
  let verified = "";
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const app = mount(document, {
      vault: {
        get status() { return { exists: true, unlocked, ready: true }; },
        async init() {},
        lock() { unlocked = false; },
        async unlock() { throw new Error("保管库已经解锁"); },
        async verifyPassword(password) {
          if (password !== "public-test-password-123") throw new Error("密码错误或保管库已损坏，未解锁");
          verified = password;
        },
        async mnemonic() { return "abandon ability able about above absent absorb abstract absurd abuse access accident"; },
        async address() { return ADDRESS; },
        subscribe() { return () => {}; },
      },
      storage: {
        async getVault() { return { version: 2 }; },
        async getBook() {
          return {
            current: "d0",
            items: [{
              id: "d0", name: "账户 1", kind: "derived", account: 0,
              address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
            }],
          };
        },
        async setBook() {},
        async getIdle() { return null; },
      },
      async fetchAddress() { return { balance: 0n, activity: [] }; },
    });
    await app.ready;
    for (let i = 0; i < 40 && document.getElementById("screen-home").hidden; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    document.querySelector('#bottomNav button[data-tab="screen-settings"]').click();
    document.getElementById("viewSeed").click();
    assert.equal(document.getElementById("screen-secret").hidden, false);
    assert.equal(document.getElementById("seedGate").hidden, false);
    document.getElementById("seedPw").value = "wrong-password-123456";
    document.getElementById("seedUnlock").click();
    for (let i = 0; i < 20 && !document.getElementById("seedError").textContent; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.match(document.getElementById("seedError").textContent, /Wrong password|密码不正确/);
    document.getElementById("seedPw").value = "public-test-password-123";
    document.getElementById("seedUnlock").click();
    for (let i = 0; i < 40 && document.getElementById("seedPanel").hidden; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(verified, "public-test-password-123");
    assert.equal(document.getElementById("seedGate").hidden, true);
    assert.equal(document.getElementById("seedPanel").hidden, false);
    assert.equal(document.getElementById("seedError").textContent, "");
    assert.match(document.getElementById("seedGrid").textContent, /••••/);
  } finally {
    globalThis.document = previous;
  }
});

test("a wallet-less welcome screen can switch networks and come back", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let saved = null;
  const app = mount(document, {
    vault: {
      get status() { return { exists: false, unlocked: false, ready: true }; },
      async init() {},
      subscribe() { return () => {}; },
    },
    storage: {
      async getVault() { return null; },
      async getBook() { return null; },
      async setBook() {},
    },
    async fetchAddress() { return { balance: 0n, activity: [] }; },
    networkPrefs: { networkId: "Pearl testnet", indexerMode: "default" },
    async applyNetworkPrefs(draft) {
      saved = draft;
      return draft;
    },
  });
  await app.ready;
  assert.equal(document.getElementById("screen-welcome").hidden, false);
  assert.equal(document.getElementById("welcomeNetLabel").textContent, "Testnet");
  document.getElementById("welcomeNet").click();
  assert.equal(document.getElementById("screen-network").hidden, false);
  assert.equal(document.querySelector("#screen-network [data-back]").dataset.back, "screen-welcome");
  document.querySelector("#screen-network [data-back]").click();
  assert.equal(document.getElementById("screen-welcome").hidden, false);
  document.getElementById("welcomeNet").click();
  document.querySelector('#netPresetList [data-profile="mainnet"]').click();
  await until(() => saved?.networkId === "Pearl mainnet" && document.getElementById("screen-welcome").hidden === false);
  assert.equal(saved.networkId, "Pearl mainnet");
  assert.equal(document.getElementById("screen-welcome").hidden, false);
  assert.equal(document.getElementById("welcomeNetLabel").textContent, "Mainnet");
});

test("home paints balance before a slow gap rescan finishes", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  let releaseScan;
  const scanGate = new Promise((resolve) => { releaseScan = resolve; });
  let unlocked = true;
  const app = mount(document, {
    vault: {
      get status() { return { exists: true, unlocked, ready: true }; },
      async init() {},
      async address(branch, index) {
        if (branch === 0 && index === 0) return ADDRESS;
        if (branch === 1 && index === 0) return CHANGE;
        return `${ADDRESS}-${branch}-${index}`;
      },
      subscribe() { return () => {}; },
    },
    storage: {
      async getVault() { return { version: 2 }; },
      async getBook() {
        return {
          current: "d0",
          items: [{
            id: "d0", name: "Account 1", kind: "derived", account: 0,
            address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
          }],
        };
      },
      async setBook() {},
      async getMeta() { return null; },
      async setMeta() {},
      async getIdle() { return null; },
    },
    async fetchAddress(address) {
      if (address !== ADDRESS && address !== CHANGE) await scanGate;
      if (address === ADDRESS) {
        return {
          balance: 250000000n,
          activity: [{
            txid: "33".repeat(32), direction: "in", amount: 250000000n, confirmations: 1, time: 1_700_000_100,
          }],
        };
      }
      return { balance: 0n, activity: [], txCount: 0 };
    },
  });
  // ready awaits the full gap rescan; assert the early balance paint before releasing it.
  await until(() => document.getElementById("homeBalance").textContent === "2.5");
  assert.equal(document.getElementById("homeBalance").textContent, "2.5");
  assert.equal(document.getElementById("balanceCard").classList.contains("soft-refresh"), true);
  releaseScan();
  await app.ready;
  await until(() => document.getElementById("balanceCard").classList.contains("soft-refresh") === false);
  assert.equal(document.getElementById("homeBalance").textContent, "2.5");
});

test("home network chip opens the network screen and returns to home", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  const TESTNET_RECV = "tprl1pc8du0xq0z0gr3ft7eaqpdtztkjf9gzmjy3qmxxlgaymtxa0dcumq7wunsu";
  const TESTNET_CHANGE = "tprl1p6nun4sakj570adkpl48szzw22pywy7f3h52dc42uqgx29m6rl2nqmv5hgc";
  let unlocked = true;
  let saved = null;
  let networkId = "Pearl mainnet";
  const app = mount(document, {
    vault: {
      get status() { return { exists: true, unlocked, ready: true }; },
      async init() {},
      async address(branch, index) {
        const receive = networkId === "Pearl testnet" ? TESTNET_RECV : ADDRESS;
        const change = networkId === "Pearl testnet" ? TESTNET_CHANGE : CHANGE;
        if (branch === 0 && index === 0) return receive;
        if (branch === 1 && index === 0) return change;
        return `${receive}-${branch}-${index}`;
      },
      async switchNetwork() {},
      subscribe() { return () => {}; },
    },
    storage: {
      async getVault() { return { version: 2 }; },
      async getBook() {
        return {
          current: "d0",
          items: [{
            id: "d0", name: "Account 1", kind: "derived", account: 0,
            address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
          }],
        };
      },
      async setBook() {},
      async getMeta() { return { homeScan: { d0: [ADDRESS] }, cursors: { d0: { receiveNext: 0, changeNext: 0 } } }; },
      async setMeta() {},
      async getIdle() { return null; },
    },
    async fetchAddress() { return { balance: 0n, activity: [] }; },
    networkPrefs: { networkId: "Pearl mainnet", indexerMode: "default" },
    async applyNetworkPrefs(draft) {
      saved = draft;
      networkId = draft.networkId;
      return draft;
    },
  });
  await app.ready;
  await until(() => document.getElementById("screen-home").hidden === false);
  assert.equal(document.getElementById("netDotLabel").textContent, "Mainnet");
  document.getElementById("netDot").click();
  assert.equal(document.getElementById("screen-network").hidden, false);
  assert.equal(document.querySelector("#screen-network [data-back]").dataset.back, "screen-home");
  document.querySelector("#screen-network [data-back]").click();
  await until(() => document.getElementById("screen-home").hidden === false);
  document.getElementById("netDot").click();
  document.querySelector('#netPresetList [data-profile="testnet"]').click();
  await until(() => saved?.networkId === "Pearl testnet" && document.getElementById("screen-home").hidden === false);
  assert.equal(saved.networkId, "Pearl testnet");
  assert.equal(document.getElementById("screen-home").hidden, false);
  assert.equal(document.getElementById("netDotLabel").textContent, "Testnet");
});

test("network switch keeps watch addresses and restores them when returning", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  const TESTNET_RECV = "tprl1pc8du0xq0z0gr3ft7eaqpdtztkjf9gzmjy3qmxxlgaymtxa0dcumq7wunsu";
  let unlocked = true;
  let networkId = "Pearl mainnet";
  let book = {
    current: "w1",
    items: [
      {
        id: "d0", name: "Account 1", kind: "derived", account: 0,
        address: ADDRESS, receiveIndex: 0, changeIndex: 0, gapLimit: 2,
      },
      { id: "w1", name: "观察地址", kind: "watch", address: ADDRESS },
    ],
  };
  const app = mount(document, {
    vault: {
      get status() { return { exists: true, unlocked, ready: true }; },
      async init() {},
      async address() {
        return networkId === "Pearl testnet" ? TESTNET_RECV : ADDRESS;
      },
      async noteBook(next) { book = next; },
      async switchNetwork() {},
      subscribe() { return () => {}; },
    },
    storage: {
      async getVault() { return { version: 2 }; },
      async getBook() { return book; },
      async setBook(next) { book = next; },
      async getMeta() { return {}; },
      async setMeta() {},
      async getIdle() { return null; },
    },
    async fetchAddress() { return { balance: 0n, activity: [] }; },
    networkPrefs: { networkId: "Pearl mainnet", indexerMode: "default" },
    async applyNetworkPrefs(draft) {
      networkId = draft.networkId;
      return draft;
    },
  });
  await app.ready;
  await until(() => document.getElementById("screen-home").hidden === false);
  assert.ok(book.items.some((item) => item.id === "w1" && item.kind === "watch"));

  document.getElementById("netDot").click();
  document.querySelector('#netPresetList [data-profile="testnet"]').click();
  await until(() => networkId === "Pearl testnet" && document.getElementById("netDotLabel").textContent === "Testnet");
  assert.ok(book.items.some((item) => item.id === "w1" && item.address === ADDRESS));
  assert.equal(book.current, "d0");

  document.getElementById("netDot").click();
  document.querySelector('#netPresetList [data-profile="mainnet"]').click();
  await until(() => networkId === "Pearl mainnet" && document.getElementById("netDotLabel").textContent === "Mainnet");
  assert.ok(book.items.some((item) => item.id === "w1" && item.kind === "watch" && item.address === ADDRESS));
});

test("activity and settings keep the same top network switcher as home", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  const app = mount(document, {
    vault: {
      get status() { return { exists: false, unlocked: false, ready: true }; },
      async init() {},
      subscribe() { return () => {}; },
    },
    storage: {
      async getVault() { return null; },
      async getBook() {
        return { current: "w1", items: [{ id: "w1", name: "Watch", kind: "watch", address: ADDRESS }] };
      },
      async setBook() {},
    },
    async fetchAddress() { return { balance: 0n, activity: [] }; },
    networkPrefs: { networkId: "Pearl mainnet", indexerMode: "default" },
  });
  await app.ready;
  await until(() => document.getElementById("screen-home").hidden === false);
  assert.equal(document.getElementById("topBar").hidden, false);

  document.querySelector('#bottomNav button[data-tab="screen-activity"]').click();
  await until(() => !document.getElementById("screen-activity").hidden);
  assert.equal(document.getElementById("topBar").hidden, false);
  document.getElementById("netDot").click();
  assert.equal(document.getElementById("screen-network").hidden, false);
  assert.equal(document.querySelector("#screen-network [data-back]").dataset.back, "screen-activity");
  document.querySelector("#screen-network [data-back]").click();
  await until(() => !document.getElementById("screen-activity").hidden);

  document.querySelector('#bottomNav button[data-tab="screen-settings"]').click();
  await until(() => !document.getElementById("screen-settings").hidden);
  assert.equal(document.getElementById("topBar").hidden, false);
  assert.equal(document.getElementById("settingsNetBadge"), null);
  assert.equal(document.getElementById("settingsVersionChip"), null);
  document.getElementById("netDot").click();
  assert.equal(document.getElementById("screen-network").hidden, false);
  assert.equal(document.querySelector("#screen-network [data-back]").dataset.back, "screen-settings");
});

test("settings shows manifest version and can check for updates", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  const previousChrome = globalThis.chrome;
  const session = {};
  let checkCalls = 0;
  let reloads = 0;
  let updateListener = null;
  globalThis.chrome = {
    runtime: {
      id: "pearl-pocket-test",
      getManifest() { return { version: "1.0.1" }; },
      async requestUpdateCheck() {
        checkCalls += 1;
        return { status: "no_update" };
      },
      reload() { reloads += 1; },
      onUpdateAvailable: {
        addListener(fn) { updateListener = fn; },
      },
    },
    storage: {
      session: {
        async get(key) {
          const name = typeof key === "string" ? key : Object.keys(key || {})[0];
          return { [name]: session[name] };
        },
        async set(values) { Object.assign(session, values); },
      },
    },
  };
  try {
    const app = mount(document, {
      vault: {
        get status() { return { exists: false, unlocked: false, ready: true }; },
        async init() {},
        subscribe() { return () => {}; },
      },
      storage: {
        async getVault() { return null; },
        async getBook() {
          return { current: "w1", items: [{ id: "w1", name: "Watch", kind: "watch", address: ADDRESS }] };
        },
        async setBook() {},
      },
      async fetchAddress() { return { balance: 0n, activity: [] }; },
    });
    await app.ready;
    document.querySelector('#bottomNav button[data-tab="screen-settings"]').click();
    await until(() => !document.getElementById("screen-settings").hidden);
    assert.equal(document.getElementById("appVersion").textContent, "1.0.1");
    assert.equal(document.getElementById("topBar").hidden, false);
    assert.equal(document.getElementById("netDotLabel").textContent, "Mainnet");
    assert.equal(document.getElementById("updateBanner").hidden, true);

    document.getElementById("checkUpdate").click();
    await until(() => document.getElementById("updateHint").hidden === false);
    assert.equal(checkCalls, 1);
    assert.match(document.getElementById("updateHint").textContent, /latest version|已是最新/);

    assert.ok(typeof updateListener === "function");
    updateListener({ version: "1.0.2" });
    await until(() => document.getElementById("updateBanner").hidden === false);
    assert.match(document.getElementById("updateBannerText").textContent, /1\.0\.2/);
    assert.equal(session.pearlUpdatePending, "1.0.2");

    document.getElementById("reloadForUpdate").click();
    assert.equal(reloads, 1);
  } finally {
    globalThis.chrome = previousChrome;
  }
});
