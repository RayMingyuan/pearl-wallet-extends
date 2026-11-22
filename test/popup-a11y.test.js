import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseHTML } from "linkedom";
import { mountShell } from "../src/shell.js";

test("popup announces field errors and keeps hidden screens out of layout", () => {
  const html = readFileSync(new URL("../src/popup.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/popup.css", import.meta.url), "utf8");
  assert.match(html, /<dialog class="drawer" id="accountSheet" hidden>/);
  assert.match(html, /role="alert" id="lockError"/);
  assert.match(html, /id="toast" role="status" aria-live="polite"/);
  assert.equal(html.includes('id="boot-state" role="alert"'), false);
  assert.match(css, /\.screen\[hidden\] \{ content-visibility: hidden; \}/);
  assert.match(css, /aria-invalid="true"/);
  assert.match(html, /id="netDot"[^>]*aria-label="Network"/);
  assert.match(html, /id="netDotLabel"[^>]*>Mainnet/);
  assert.match(html, /id="switchName"/);
  assert.match(css, /#switchName[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(html, /id="openPrivacy"/);
  assert.match(html, /id="openDonate"/);
  assert.match(html, /id="openSite"/);
  assert.match(html, /pearla\.net/);
  assert.match(html, /id="openSource"/);
  assert.match(html, /data-i18n="settings\.source"/);
  assert.match(html, /id="checkUpdate"/);
  assert.match(html, /id="appVersion"/);
  assert.equal(html.includes("settingsVersionChip"), false);
  assert.equal(html.includes("settingsNetBadge"), false);
  assert.match(html, /id="updateBanner"/);
  assert.match(html, /id="reloadForUpdate"/);
  assert.match(html, /id="updateHint"/);
  assert.match(html, /data-i18n="settings\.version"/);
  assert.match(html, /id="screen-donate"/);
  assert.match(html, /class="lock-logo"/);
  assert.match(html, /class="lock-logo-mark"/);
  assert.match(html, /icons\/pearl\.png/);
  assert.match(css, /@keyframes lock-logo-bounce/);
  const shell = readFileSync(new URL("../src/shell.js", import.meta.url), "utf8");
  assert.match(shell, /https:\/\/pearla\.net/);
  assert.match(shell, /github\.com\/RayMingyuan\/pearl-wallet-extends/);
  assert.match(shell, /requestUpdateCheck/);
  assert.match(shell, /onUpdateAvailable/);
  assert.match(shell, /pearlUpdatePending/);
  assert.match(html, /settings-hero/);
  assert.equal(html.includes("settings-pearl"), false);
  assert.match(html, /id="lockNow"[^>]*data-i18n-aria-label="home\.lockNow"/);
  assert.equal(html.includes("settings-lock"), false);
  assert.match(html, /data-i18n="settings\.wallet"/);
  assert.match(html, /data-i18n="settings\.about"/);
  assert.match(html, /id="watchWallet"[^>]*data-i18n="welcome\.watchOnly"/);
  assert.match(html, /id="langEn"/);
  assert.match(html, /id="langZh"/);
  assert.match(html, /data-i18n="settings\.language"/);
  assert.equal(html.includes("只看一个地址"), false);
  const welcome = html.slice(html.indexOf('id="screen-welcome"'), html.indexOf("</section>", html.indexOf('id="screen-welcome"')));
  assert.equal(welcome.includes("blockbook.pearlresearch.ai"), false);
  assert.equal(welcome.includes("社区版钱包"), false);
  assert.match(welcome, /logo-wordmark\.png/);
  assert.match(welcome, /The pearl in your pocket/);
  const watch = html.slice(html.indexOf('id="screen-watch"'), html.indexOf("</section>", html.indexOf('id="screen-watch"')));
  assert.equal(watch.includes("blockbook.pearlresearch.ai"), false);
  assert.match(watch, /data-i18n="watch\.title"/);
  assert.match(watch, /data-i18n="watch\.sub"/);
  const privacy = html.slice(html.indexOf('id="screen-privacy"'), html.indexOf("</section>", html.indexOf('id="screen-privacy"')));
  assert.match(privacy, /blockbook\.pearlresearch\.ai/);
  const send = html.slice(html.indexOf('id="screen-send"'), html.indexOf("</section>", html.indexOf('id="screen-send"')));
  assert.match(send, /id="toConfirm"/);
  assert.match(send, /data-i18n="action\.review"/);
  assert.match(send, /id="sendDirect"/);
  assert.match(send, /data-i18n="action\.sendDirect"/);
  assert.match(html, /id="sendAuthRemember"/);
  assert.match(html, /id="sendAuthMins"/);
  assert.match(html, /id="sendBusy"/);
  assert.match(html, /id="sendBusyText"/);
  assert.match(send, /class="amt-quick"/);
  assert.match(send, /data-pct="25"/);
  assert.match(send, /data-pct="50"/);
  assert.match(send, /data-pct="75"/);
  assert.match(send, /id="maxBtn"/);
  const confirm = html.slice(html.indexOf('id="screen-confirm"'), html.indexOf("</section>", html.indexOf('id="screen-confirm"')));
  assert.match(confirm, /id="confirmSend"/);
  assert.match(confirm, /data-i18n="confirm\.signSend"/);
  assert.equal(confirm.includes("确认并输入密码"), false);
  assert.equal(confirm.includes("确认后本地签名"), false);
  assert.equal(confirm.includes("blockbook.pearlresearch.ai"), false);
  const home = html.slice(html.indexOf('id="screen-home"'), html.indexOf("</section>", html.indexOf('id="screen-home"')));
  assert.equal(home.includes("blockbook.pearlresearch.ai"), false);
  assert.match(home, /icons\/pearl\.webp/);
  assert.match(home, /balance-unit">PEARL</);
  assert.match(home, /id="hideBalance"[\s\S]*data-i18n-aria-label="home\.hideBalance"/);
  assert.match(html, /id="lockPw"[^>]*data-i18n-placeholder="lock\.placeholder"/);
  assert.match(html, /id="lockPw"[^>]*data-i18n-aria-label="lock\.passwordAria"/);
  assert.equal(html.includes("创建时的密码"), false);
  assert.match(html, /id="goReceive"[\s\S]*data-i18n="home\.receive"/);
  assert.match(html, /id="accountKind"/);
  assert.match(html, /id="sendLimit"/);
  assert.match(html, /id="newPw2"/);
  assert.match(html, /id="pwChangeError"/);
  assert.match(html, /data-tab="screen-home"[\s\S]*data-i18n="nav\.assets"/);
  assert.equal(html.includes("↓"), false);
  assert.equal(html.includes("↑"), false);
  assert.equal(html.includes("https://"), false);
});

test("account drawer closes on escape and marks the password field invalid", async () => {
  const { document } = parseHTML(readFileSync(new URL("../src/popup.html", import.meta.url), "utf8"));
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    const vault = {
      get status() { return { exists: true, unlocked: false, ready: true }; },
      async init() {},
      async unlock() { throw new Error("密码错误"); },
      subscribe() { return () => {}; },
    };
    const storage = {
      async getBook() { return null; },
    };
    const app = mountShell(document, {
      vault, storage,
      async fetchAddress() { throw new Error("不应查询"); },
      async fetchUtxos() { return []; },
      broadcaster: {},
      async copyText() {},
      async drawQr() {},
    });
    await app.ready;
    assert.equal(document.getElementById("screen-lock").hidden, false);
    document.getElementById("lockPw").value = "wrong-password-123";
    document.getElementById("lockUnlock").click();
    for (let i = 0; i < 20 && !document.getElementById("lockError").textContent; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(document.getElementById("lockError").textContent, "Wrong password — try again");
    assert.equal(document.getElementById("lockPw").getAttribute("aria-invalid"), "true");

    document.getElementById("accountSwitch").click();
    const sheet = document.getElementById("accountSheet");
    assert.equal(sheet.hidden, false);
    assert.equal(document.querySelector(".wallet > .body").inert, true);
    const escape = new document.defaultView.Event("keydown", { bubbles: true });
    escape.key = "Escape";
    document.dispatchEvent(escape);
    assert.equal(sheet.hidden, true);
    assert.equal(document.querySelector(".wallet > .body").inert, false);
  } finally {
    globalThis.document = previous;
  }
});