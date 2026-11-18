// An unfinished popup lives only in offscreen memory. It is not written to chrome.storage.local or to session storage.
export const POPUP_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
// A mnemonic, seed, or password expires sooner, and the offscreen document clears it when that timer fires.
export const POPUP_SECRET_DRAFT_TTL_MS = 10 * 60 * 1000;

const SEND_SCREENS = new Set(["screen-send", "screen-confirm"]);
const SETUP_SCREENS = new Set([
  "screen-password",
  "screen-notice",
  "screen-mnemonic",
  "screen-verify",
  "screen-import",
  "screen-import-entry",
  "screen-watch",
]);

function clip(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function whole(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

function txid(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{64}$/.test(text) ? text : "";
}

function draftHasSecret(draft) {
  return Boolean(draft.password || draft.mnemonic || draft.importText || draft.pw1 || draft.pw2);
}

export function popupDraftTtl(draft) {
  return draftHasSecret(draft) ? POPUP_SECRET_DRAFT_TTL_MS : POPUP_DRAFT_TTL_MS;
}

export function sanitizePopupDraft(value, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.v !== 1) return null;
  if (typeof value.at !== "number" || !Number.isFinite(value.at)) return null;
  if (value.at > now + 60_000) return null;
  if (SEND_SCREENS.has(value.screen)) {
    if (now - value.at > POPUP_DRAFT_TTL_MS) return null;
    const fee = value.fee === "slow" || value.fee === "fast" ? value.fee : "standard";
    return {
      v: 1,
      at: value.at,
      screen: "screen-send",
      flow: "send",
      sendTo: clip(value.sendTo, 200),
      sendAmount: clip(value.sendAmount, 40),
      sendMax: value.sendMax === true,
      fee,
      custom: value.custom === true,
      customRate: clip(value.customRate, 8),
    };
  }
  if (value.screen === "screen-status" || value.flow === "status") {
    if (now - value.at > POPUP_DRAFT_TTL_MS) return null;
    const status = ["broadcasting", "broadcast", "failed", "unknown"].includes(value.status) ? value.status : "unknown";
    const id = txid(value.txid);
    return {
      v: 1,
      at: value.at,
      screen: "screen-status",
      flow: "status",
      status,
      txid: id,
      confirmations: whole(value.confirmations, 100000000),
      endpoint: clip(value.endpoint, 200),
      failText: id ? "" : clip(value.failText, 200),
      network: value.network === "Pearl testnet" ? "Pearl testnet" : "Pearl mainnet",
    };
  }
  if (value.screen === "screen-tx" || value.flow === "tx") {
    if (now - value.at > POPUP_DRAFT_TTL_MS) return null;
    const id = txid(value.txid);
    if (!id) return null;
    const amount = typeof value.amount === "string" && /^\d{1,20}$/.test(value.amount) ? value.amount : "0";
    return {
      v: 1,
      at: value.at,
      screen: "screen-tx",
      flow: "tx",
      txid: id,
      direction: value.direction === "in" || value.direction === "out" ? value.direction : "self",
      amount,
      time: whole(value.time, 10_000_000_000),
      confirmations: whole(value.confirmations, 100000000),
      back: value.back === "screen-home" ? "screen-home" : "screen-activity",
      network: value.network === "Pearl testnet" ? "Pearl testnet" : "Pearl mainnet",
    };
  }
  if (value.screen === "screen-network" || value.flow === "network") {
    if (now - value.at > POPUP_DRAFT_TTL_MS) return null;
    const port = clip(value.port, 5);
    return {
      v: 1,
      at: value.at,
      screen: "screen-network",
      flow: "network",
      networkId: value.networkId === "Pearl testnet" ? "Pearl testnet" : "Pearl mainnet",
      scheme: value.scheme === "http" ? "http" : "https",
      host: clip(value.host, 253).trim(),
      port: /^\d{0,5}$/.test(port) ? port : "",
    };
  }
  if (value.screen === "screen-secret" || value.flow === "secret" || value.screen === "screen-pwchange" || value.flow === "pwchange") {
    if (now - value.at > POPUP_DRAFT_TTL_MS) return null;
    const secret = value.screen === "screen-secret" || value.flow === "secret";
    return {
      v: 1,
      at: value.at,
      screen: secret ? "screen-secret" : "screen-pwchange",
      flow: secret ? "secret" : "pwchange",
    };
  }
  if (now - value.at > POPUP_DRAFT_TTL_MS) return null;
  if (!SETUP_SCREENS.has(value.screen)) return null;
  const flow = value.flow === "import" || value.flow === "watch" ? value.flow : "create";
  const keepMnemonic = value.screen === "screen-mnemonic" || value.screen === "screen-verify";
  const kept = {
    v: 1,
    at: value.at,
    screen: value.screen,
    flow: value.screen === "screen-watch" ? "watch" : flow,
    password: clip(value.password, 200),
    mnemonic: keepMnemonic ? clip(value.mnemonic, 500) : "",
    mnemonicWords: value.mnemonicWords === 24 ? 24 : 12,
    wordsRevealed: keepMnemonic && value.wordsRevealed === true,
    ackRisk: value.ackRisk === true,
    ackHand: value.ackHand === true,
    importKind: value.importKind === "hex" ? "hex" : "mnemonic",
    importText: clip(value.importText, 2000),
    pw1: clip(value.pw1, 200),
    pw2: clip(value.pw2, 200),
    watchInput: clip(value.watchInput, 200),
  };
  if (now - value.at > popupDraftTtl(kept)) return null;
  return kept;
}

export function createPopupDraftMemory({ now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let draft = null;
  let timer = null;
  function clearTimer() {
    if (timer != null) cancel(timer);
    timer = null;
  }
  function remember(next) {
    clearTimer();
    draft = next;
    if (!draft) return;
    const wait = draft.at + popupDraftTtl(draft) - now();
    if (wait <= 0) {
      draft = null;
      return;
    }
    timer = schedule(() => {
      draft = null;
      timer = null;
    }, wait);
    if (timer && typeof timer.unref === "function") timer.unref();
  }
  return {
    handle(message) {
      const op = message?.op;
      if (op === "clear") remember(null);
      else if (op === "set") remember(sanitizePopupDraft(message.draft, now()));
      else if (draft && !sanitizePopupDraft(draft, now())) remember(null);
      return { ok: true, target: "popup-draft", draft };
    },
  };
}
