import QRCode from "qrcode";
import { drawBrandedQr } from "./qr-brand.js";
import { fetchSpendableUtxos, fetchWatchAddress } from "./blockbook.js";
import { createBlockbookBroadcastTransport } from "./blockbook-broadcast.js";
import { createPublicBroadcaster } from "./broadcast.js";
import { createBroadcastJournal } from "./broadcast-journal.js";
import { fetchFeeMenu } from "./blockbook-fees.js";
import { fetchPearlUsdSpot } from "./pearl-price.js";
import { createMainnetStore } from "./mainnet-storage.js";
import { mountShell } from "./shell.js";
import { createChromeStorage, invokeStore } from "./storage.js";
import { createSpendGuard, SPEND_LOCKS_KEY } from "./spend-guard.js";
import { createEndpoints } from "./endpoints.js";
import { createVaultProxy } from "./vault-proxy.js";
import { idleMinutes, META_KEY } from "./vault-directory.js";
import {
  NETWORK_MAINNET,
  NETWORK_PREFS_KEY,
  defaultNetworkPrefs,
  indexerPermissionOrigin,
  needsOptionalHostPermission,
  normalizeNetworkPrefs,
} from "./network-prefs.js";
import { LOCALE_KEY, DEFAULT_LOCALE, normalizeLocale, setLocale, err } from "./i18n.js";

async function askPopupDraft(op, draft) {
  const send = globalThis.chrome?.runtime?.sendMessage;
  if (typeof send !== "function") return null;
  try {
    const response = await send({ target: "popup-draft", op, draft });
    if (response?.target !== "popup-draft" || response.ok !== true) return null;
    return response.draft ?? null;
  } catch {
    return null;
  }
}

const BOOK_KEY = "prlAccountBook";
const IDLE_KEY = "prlIdleMin";
const HOME_SNAPSHOT_KEY = "prlHomeSnapshot";

function showBootError(message) {
  const el = document.getElementById("boot-state");
  if (!el) return;
  el.hidden = false;
  el.textContent = message;
}

async function ensureIndexerPermission(origin) {
  if (!needsOptionalHostPermission(origin)) return true;
  const permissions = globalThis.chrome?.permissions;
  if (!permissions?.request) throw err("err.popup.permissionsUnavailable");
  const origins = [indexerPermissionOrigin(origin)];
  const already = await permissions.contains({ origins });
  if (already) return true;
  const granted = await permissions.request({ origins });
  if (!granted) throw err("err.popup.indexerNotGranted");
  return true;
}

try {
  const chromeStorage = globalThis.chrome?.storage?.local;
  const localWalletStore = createChromeStorage(chromeStorage);
  const storage = {
    ...localWalletStore,
    async getBook() { return (await invokeStore(chromeStorage, "get", [BOOK_KEY], 4000))[BOOK_KEY] ?? null; },
    async setBook(book) { await invokeStore(chromeStorage, "set", [{ [BOOK_KEY]: book }], 4000); },
    async getIdle() { return (await invokeStore(chromeStorage, "get", [IDLE_KEY], 4000))[IDLE_KEY] ?? null; },
    async setIdle(min) { await invokeStore(chromeStorage, "set", [{ [IDLE_KEY]: min }], 4000); },
    async getMeta() { return (await invokeStore(chromeStorage, "get", [META_KEY], 4000))[META_KEY] ?? null; },
    async setMeta(meta) { await invokeStore(chromeStorage, "set", [{ [META_KEY]: meta }], 4000); },
    async getSpendLocks() { return (await invokeStore(chromeStorage, "get", [SPEND_LOCKS_KEY], 4000))[SPEND_LOCKS_KEY] ?? []; },
    async setSpendLocks(list) { await invokeStore(chromeStorage, "set", [{ [SPEND_LOCKS_KEY]: list }], 4000); },
    async getNetworkPrefs() {
      const got = await invokeStore(chromeStorage, "get", [NETWORK_PREFS_KEY], 4000);
      try { return normalizeNetworkPrefs(got?.[NETWORK_PREFS_KEY]); }
      catch { return defaultNetworkPrefs(); }
    },
    async setNetworkPrefs(prefs) {
      const next = normalizeNetworkPrefs(prefs);
      await invokeStore(chromeStorage, "set", [{ [NETWORK_PREFS_KEY]: next }], 4000);
      return next;
    },
    async getLocale() {
      const got = await invokeStore(chromeStorage, "get", [LOCALE_KEY], 4000);
      return got?.[LOCALE_KEY] ?? null;
    },
    async setLocale(locale) {
      const next = normalizeLocale(locale);
      await invokeStore(chromeStorage, "set", [{ [LOCALE_KEY]: next }], 4000);
      return next;
    },
    async getHomeSnapshots() {
      const session = globalThis.chrome?.storage?.session;
      if (!session?.get) return null;
      const got = await invokeStore(session, "get", [HOME_SNAPSHOT_KEY], 4000);
      return got?.[HOME_SNAPSHOT_KEY] ?? null;
    },
    async setHomeSnapshots(value) {
      const session = globalThis.chrome?.storage?.session;
      if (!session?.set) return;
      await invokeStore(session, "set", [{ [HOME_SNAPSHOT_KEY]: value }], 4000);
    },
    getPopupDraft() { return askPopupDraft("get"); },
    setPopupDraft(draft) { return askPopupDraft("set", draft); },
    clearPopupDraft() { return askPopupDraft("clear"); },
  };
  const boot = (async () => {
    try {
      const savedLocale = await storage.getLocale();
      if (savedLocale) setLocale(normalizeLocale(savedLocale));
      else setLocale(DEFAULT_LOCALE);
    } catch {
      setLocale(DEFAULT_LOCALE);
    }
    const savedIdle = await storage.getIdle();
    const idleMs = idleMinutes(savedIdle) * 60_000;
    let prefs = await storage.getNetworkPrefs();
    let endpoints = createEndpoints([prefs.origin]);
    const vault = createVaultProxy({ idleMs, network: prefs.networkId });
    const mainnetStore = createMainnetStore();
    const spendGuard = createSpendGuard({ storage });
    function journalFor(networkId) {
      if (networkId === NETWORK_MAINNET) return mainnetStore;
      return createBroadcastJournal(networkId, chromeStorage);
    }
    let broadcaster = createPublicBroadcaster({
      network: prefs.networkId,
      store: journalFor(prefs.networkId),
      transport: createBlockbookBroadcastTransport({ origin: () => endpoints.selected() }),
      withLock(key, work) {
        if (!navigator.locks?.request) throw err("err.popup.noWebLocksSend");
        return navigator.locks.request(`prl-broadcast:${key}`, { mode: "exclusive" }, work);
      },
    });
    function rebuildBroadcaster() {
      broadcaster = createPublicBroadcaster({
        network: prefs.networkId,
        store: journalFor(prefs.networkId),
        transport: createBlockbookBroadcastTransport({ origin: () => endpoints.selected() }),
        withLock(key, work) {
          if (!navigator.locks?.request) throw err("err.popup.noWebLocksSend");
          return navigator.locks.request(`prl-broadcast:${key}`, { mode: "exclusive" }, work);
        },
      });
    }
    const app = mountShell(document, {
      vault, storage,
      networkPrefs: prefs,
      indexerOrigin: () => endpoints.selected(),
      async applyNetworkPrefs(draft) {
        const next = normalizeNetworkPrefs(draft);
        await ensureIndexerPermission(next.origin);
        await vault.setNetwork(next.networkId);
        endpoints = createEndpoints([next.origin]);
        prefs = await storage.setNetworkPrefs(next);
        rebuildBroadcaster();
        try {
          const meta = (await storage.getMeta()) || {};
          await storage.setMeta({ ...meta, networkId: prefs.networkId });
        } catch { /* A failed meta write does not block the network switch. */ }
        return prefs;
      },
      fetchAddress: (address, options = {}) => endpoints.read((origin) => fetchWatchAddress(address, { origin, signal: options.signal })),
      fetchUtxos: (address, options = {}) => endpoints.read((origin) => fetchSpendableUtxos(address, {
        origin, signal: options.signal, network: options.network || prefs.networkId,
      })),
      broadcaster: {
        submit(args) { return broadcaster.submit(args); },
        refresh(txid) { return broadcaster.refresh(txid); },
      },
      mainnetStore: {
        rememberLatest(...args) {
          if (prefs.networkId !== NETWORK_MAINNET) return Promise.resolve();
          return mainnetStore.rememberLatest(...args);
        },
        getLatestForAddress(...args) {
          if (prefs.networkId !== NETWORK_MAINNET) return Promise.resolve(null);
          return mainnetStore.getLatestForAddress(...args);
        },
        getLatestSpendHintForAddress(...args) {
          if (prefs.networkId !== NETWORK_MAINNET) return Promise.resolve(null);
          return mainnetStore.getLatestSpendHintForAddress(...args);
        },
        getLatestAddressGroupForAddress(...args) {
          if (prefs.networkId !== NETWORK_MAINNET) {
            return Promise.resolve(args[0] ? [args[0]] : []);
          }
          return mainnetStore.getLatestAddressGroupForAddress(...args);
        },
        linkLatestAddresses(...args) {
          if (prefs.networkId !== NETWORK_MAINNET) return Promise.resolve(false);
          return mainnetStore.linkLatestAddresses(...args);
        },
      },
      spendGuard,
      estimateFees: () => endpoints.read((origin) => fetchFeeMenu(globalThis.fetch, origin)),
      fetchPearlUsdSpot: (options = {}) => fetchPearlUsdSpot(options),
      copyText(text) { return navigator.clipboard.writeText(text); },
      drawQr(canvas, text) {
        return drawBrandedQr(canvas, text, { qrcode: QRCode });
      },
    });
    await app.ready;
  })();
  boot.catch((error) => showBootError(error instanceof Error ? error.message : "初始化失败"));
} catch (error) {
  showBootError(error instanceof Error ? error.message : "初始化失败");
}
