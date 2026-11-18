import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Script } from "node:vm";
import { parseHTML } from "linkedom";
import { createVaultSession, dispatchVault } from "../src/vault-host.js";

function vaultRuntime(stored, writes) {
  const session = createVaultSession();
  let popupDraft = null;
  return {
    id: "pearl-pocket-test",
    async sendMessage(message) {
      if (message?.target === "popup-draft") {
        if (message.op === "clear") popupDraft = null;
        else if (message.op === "set") popupDraft = message.draft ?? null;
        return { ok: true, target: "popup-draft", draft: popupDraft };
      }
      const response = await dispatchVault(session, { ...message, record: stored.pearlVault ?? null });
      if (response.stored?.changed) {
        if (response.stored.record) {
          stored.pearlVault = response.stored.record;
          writes?.push({ pearlVault: response.stored.record });
        } else {
          delete stored.pearlVault;
          writes?.push({ pearlVault: null });
        }
      }
      return { ok: response.ok, status: response.status, result: response.result, error: response.error };
    },
    onMessage: { addListener() {} },
  };
}
const DIST = "dist";
const ALLOWED_HTTPS = "https://blockbook.pearlresearch.ai";

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

test("built extension is MV3 with a fixed host and strict CSP", () => {
  const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage", "offscreen"]);
  assert.deepEqual(manifest.host_permissions, [
    `${ALLOWED_HTTPS}/*`,
    "https://blockbook.testnet.pearlresearch.ai/*",
    "https://api.coinbase.com/*",
    "https://api.exchange.coinbase.com/*",
    "https://api.coingecko.com/*",
  ]);
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.content_scripts, undefined);
  const csp = manifest.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'self'/);
  assert.equal(csp.includes("unsafe-eval"), false);
  assert.equal(csp.includes("unsafe-inline"), false);
  assert.equal(csp.includes("http:"), false);
  assert.equal(csp.includes("https:"), false);
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(manifest.name, "Pearla");
  assert.equal(manifest.description.includes("单地址"), false);
  assert.equal(manifest.description.includes("测试交易"), false);
  assert.match(manifest.description, /Pearla/);
  assert.match(manifest.description, /community-edition Pearl wallet/);
  assert.ok(manifest.description.length <= 132);
});

test("dist has no remote script, inline handler, sync storage or wallet-RPC entry", () => {
  const files = walk(DIST);
  assert.ok(files.some((file) => file.endsWith("popup.js")));
  assert.ok(files.some((file) => file.endsWith("background.js")));
  assert.ok(files.some((file) => file.endsWith("offscreen.js")));
  assert.ok(files.some((file) => file.endsWith("icon128.png")));
  const html = readFileSync(join(DIST, "popup.html"), "utf8");
  assert.equal(/<script(?![^>]*\ssrc="popup\.js")/i.test(html), false);
  assert.equal(html.includes("onclick="), false);
  assert.equal(html.includes("http://"), false);
  assert.equal(html.includes("https://"), false);
  const css = readFileSync(join(DIST, "popup.css"), "utf8");
  assert.equal(css.includes("@import"), false);
  assert.equal(css.includes("http"), false);
  const js = readFileSync(join(DIST, "popup.js"), "utf8");
  assert.equal(js.includes("eval("), false);
  assert.equal(js.includes("new Function"), false);
  assert.equal(js.includes("unsafe-eval"), false);
  assert.equal(js.includes("chrome.storage.sync"), false);
  assert.equal(js.includes("storage.sync"), false);
  assert.equal(js.includes("/api/v2/sendtx/"), true);
  assert.equal(js.includes("signrawtransaction"), false);
  assert.equal(js.includes("sendrawtransaction"), false);
  // qrcode keeps the SVG XML namespace as a string. It is not fetched.
  const urls = js.match(/https?:\/\/[^"'`\s)]+/g) || [];
  assert.deepEqual([...new Set(urls)].sort(), [
    "http://www.w3.org/2000/svg",
    "https://api.coinbase.com",
    "https://api.coingecko.com",
    "https://api.exchange.coinbase.com",
    ALLOWED_HTTPS,
    "https://blockbook.testnet.pearlresearch.ai",
    "https://github.com/RayMingyuan/pearl-wallet-extends",
    "https://pearla.net",
  ]);
  assert.match(js, /prlAccountBook/);
  assert.match(js, /pearlVault/);
  assert.match(js, /async function scanChain/);
  const notices = readFileSync(join(DIST, "THIRD_PARTY_LICENSES.txt"), "utf8");
  for (const name of ["@noble/curves", "@noble/hashes", "@scure/bip32", "@scure/bip39", "@scure/base", "qrcode"]) {
    assert.ok(notices.includes(name));
  }
});

test("built classic popup encrypts a seed, prepares and signs locally with GET queries only", async (t) => {
  const html = readFileSync(join(DIST, "popup.html"), "utf8");
  const { document } = parseHTML(html);
  const scriptElement = document.querySelector("script[src]");
  assert.equal(scriptElement.getAttribute("type"), null);
  const source = readFileSync(join(DIST, scriptElement.getAttribute("src")), "utf8");
  // Parse the built files the way the HTML loads them, so an unpackaged import cannot slip into the package.
  const script = new Script(source, { filename: "popup.js" });
  const writes = [];
  const queries = [];
  const stored = {};
  const transaction = JSON.parse(readFileSync("test/fixtures/pearl-transactions-v1.5.5.json", "utf8")).vectors[0];
  t.after(() => document.defaultView.dispatchEvent(new document.defaultView.Event("pagehide")));
  script.runInNewContext({
    document,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    btoa,
    atob,
    AbortController,
    navigator: { locks: { request(_name, _options, work) { return work(); } } },
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: vaultRuntime(stored, writes),
      storage: {
        local: {
          get(key, callback) {
            if (key == null) { callback({ ...stored }); return; }
            const names = Array.isArray(key) ? key : [key];
            const out = {};
            for (const name of names) out[name] = stored[name];
            callback(out);
          },
          set(value, callback) { writes.push(value); Object.assign(stored, value); callback(); },
          remove(key, callback) {
            const names = Array.isArray(key) ? key : [key];
            for (const name of names) delete stored[name];
            callback();
          },
        },
      },
    },
    async fetch(url, options = {}) {
      queries.push(url);
      if (options.method === "POST") {
        assert.ok(url.includes("/api/v2/sendtx/"));
        return { ok: true, status: 200, async text() { return JSON.stringify({ result: transaction.txid }); } };
      }
      assert.equal(options.method ?? "GET", "GET");
      assert.equal(options.body, undefined);
      const source = transaction.request.sourceAddress;
      // Only the source address has a balance. Change and rotated addresses stay empty so the mock does not inflate the aggregate test.
      let payload = url.includes(encodeURIComponent(source)) || url.includes(source)
        ? { balance: "100000000", transactions: [], txs: 0 }
        : { balance: "0", transactions: [], txs: 0 };
      if (url.includes("estimatefee")) payload = { result: "0.00002000" };
      if (url.includes("/utxo/")) {
        payload = url.includes(encodeURIComponent(source)) || url.includes(source)
          ? transaction.request.utxos.map(({ prevTxHex, ...record }) => record)
          : [];
      }
      if (url.includes("/tx/")) {
        const record = transaction.request.utxos.find((utxo) => url.endsWith(utxo.txid));
        payload = { txid: record.txid, hex: record.prevTxHex };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(payload);
        },
      };
    },
  });
  async function until(check) {
    for (let i = 0; i < 1500; i += 1) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const hint = ["importError", "homeAddr", "homeBalance", "screen-home", "screen-done"].map((id) => {
      const el = document.getElementById(id);
      if (!el) return `${id}:missing`;
      return `${id}:${el.hidden ? "hidden" : "shown"}:${el.textContent.slice(0, 80)}`;
    }).join(" | ");
    assert.fail(`构建后的弹窗没有完成初始化或查询 ${hint}`);
  }
  await until(() => document.getElementById("boot-state").hidden);
  const fixture = JSON.parse(readFileSync("src/pearl-v1.5.5.json", "utf8"));
  document.getElementById("importWallet").click();
  document.getElementById("chooseHex").click();
  document.getElementById("pw1").value = "public-bundled-test-password";
  document.getElementById("pw2").value = "public-bundled-test-password";
  document.getElementById("pwNext").click();
  document.getElementById("importText").value = fixture.seedHex;
  document.getElementById("importNext").click();
  await until(() => document.getElementById("screen-done").hidden === false);
  document.getElementById("enterWallet").click();
  // Once 0/0 has a balance, receive rotates to the next unused address. The home balance still aggregates addresses already found.
  await until(() => document.getElementById("homeAddr").textContent === fixture.vectors[1].address
    && document.getElementById("homeBalance").textContent === "1");
  assert.equal(document.getElementById("importText").value, "");
  assert.equal(JSON.stringify(writes).includes(fixture.seedHex), false);
  assert.equal(JSON.stringify(writes).includes("public-bundled-test-password"), false);
  assert.ok(writes.some((item) => Object.keys(item).join() === "pearlVault"));
  document.getElementById("goSend").click();
  await until(() => document.getElementById("feeNote").textContent.includes("180 vB")
    || document.getElementById("fee-standard")?.querySelector("[data-fee-est]")?.textContent.includes("PEARL"));
  assert.equal(document.querySelector(".fees")?.classList.contains("is-loading"), false);
  assert.match(document.getElementById("fee-standard")?.querySelector("[data-fee-rate]")?.textContent || "", /grain\/vB/);
  assert.equal(document.getElementById("sendPicks"), null);
  document.getElementById("sendTo").value = transaction.request.destination;
  document.getElementById("sendTo").dispatchEvent(new document.defaultView.Event("input", { bubbles: true }));
  document.getElementById("sendAmount").value = transaction.request.amount;
  document.getElementById("sendAmount").dispatchEvent(new document.defaultView.Event("input", { bubbles: true }));
  await until(() => document.getElementById("toConfirm").disabled === false);
  document.getElementById("toConfirm").click();
  await until(() => document.getElementById("screen-confirm").hidden === false);
  assert.ok(document.getElementById("confirmAddr").textContent.replaceAll(" ", "").includes(transaction.request.destination.slice(0, 12)));
  assert.match(document.getElementById("confirmSend").textContent, /Sign and send/);
  assert.equal(document.getElementById("screen-unlock").hidden, true);
  document.getElementById("confirmSend").click();
  await until(() => document.getElementById("screen-unlock").hidden === false);
  document.getElementById("unlockPw").value = "public-bundled-test-password";
  document.getElementById("signBtn").click();
  await until(() => /^[0-9a-f]{64}$/.test(document.getElementById("statusDetail").textContent)
    || document.getElementById("unlockError").textContent
    || document.getElementById("sendError").textContent);
  const detail = document.getElementById("statusDetail").textContent;
  const problem = document.getElementById("unlockError").textContent || document.getElementById("sendError").textContent;
  assert.equal(problem, "", problem);
  assert.equal(detail, transaction.txid);
  assert.equal(document.getElementById("rbfSpeed"), null);
  assert.ok(queries.some((url) => url.includes("/api/v2/sendtx/")));
});

function bootBuiltPopup(stored) {
  const html = readFileSync(join(DIST, "popup.html"), "utf8");
  const { document } = parseHTML(html);
  const source = readFileSync(join(DIST, "popup.js"), "utf8");
  const script = new Script(source, { filename: "popup.js" });
  const writes = [];
  script.runInNewContext({
    document,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    btoa,
    atob,
    AbortController,
    navigator: { locks: { request(_name, _options, work) { return work(); } } },
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: vaultRuntime(stored, writes),
      storage: {
        local: {
          get(key, callback) {
            if (key == null) { callback({ ...stored }); return; }
            const names = Array.isArray(key) ? key : [key];
            const out = {};
            for (const name of names) out[name] = stored[name];
            callback(out);
          },
          set(value, callback) { writes.push(value); Object.assign(stored, value); callback(); },
        },
      },
    },
    fetch() { throw new Error("不应在已有保管库时访问网络"); },
  });
  return { document, writes, stored };
}

const EXISTING_VAULT = {
  version: 2,
  kdf: "PBKDF2-SHA256",
  iterations: 600000,
  salt: Buffer.alloc(16, 3).toString("base64"),
  iv: Buffer.alloc(12, 4).toString("base64"),
  ciphertext: Buffer.alloc(32, 5).toString("base64"),
};

test("built popup opens unlock when a vault is already stored", async () => {
  const stored = { pearlVault: { ...EXISTING_VAULT } };
  const { document, writes } = bootBuiltPopup(stored);
  for (let i = 0; i < 50; i += 1) {
    if (document.getElementById("boot-state").hidden && document.getElementById("screen-lock").hidden === false) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(document.getElementById("screen-lock").hidden, false);
  assert.equal(document.getElementById("screen-welcome").hidden, true);
  assert.equal(document.getElementById("screen-verify").hidden, true);
  document.getElementById("createWallet").click();
  for (let i = 0; i < 20; i += 1) {
    if (document.getElementById("lockHint").textContent.includes("original password")) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.match(document.getElementById("lockHint").textContent, /original password/i);
  assert.match(document.getElementById("lockHint").textContent, /was not saved/i);
  assert.equal(document.getElementById("screen-lock").hidden, false);
  assert.equal(document.getElementById("screen-verify").hidden, true);
  assert.equal(document.getElementById("verifyError").textContent, "");
  assert.equal(writes.some((item) => item.pearlVault), false);
  assert.equal(stored.pearlVault.ciphertext, EXISTING_VAULT.ciphertext);
});
