import { validatePearlAddress } from "./address.js";
import { formatGrains, formatGrainsCompact } from "./amount.js";
import { applyLatestSpendHint, mergeActivityGroups, presentActivity } from "./activity.js";
import { fetchFeeMenu } from "./blockbook-fees.js";
import { formatSpotCaption, formatUsdTotal } from "./pearl-price.js";
import { addressLooksUsed, scanChain } from "./account-scan.js";
import { deriveAddress, generateMnemonic, secretToSeed } from "./keys.js";
import {
  defaultNetworkPrefs, NETWORK_MAINNET, NETWORK_TESTNET, normalizeNetworkPrefs,
} from "./network-prefs.js";
import { DONATION_ADDRESS } from "./donation.js";
import { createSpendGuard } from "./spend-guard.js";
import { buildDraft, parsePrlAmount } from "./transaction.js";
import { MIN_PASSWORD_LENGTH, UNIFORM_PASSWORD_MIN_LENGTH, isShortUniformPassword } from "./password-policy.js";
import {
  t, applyDom, getLocale, setLocale, normalizeLocale, DEFAULT_LOCALE,
  speak, unpackMessage, packMessage, err,
} from "./i18n.js";
import { IDLE_MIN_LIMIT, idleMinutes, isIdlePreset } from "./vault-directory.js";
import { sanitizePopupDraft } from "./popup-draft.js";
import { explorerTxUrl } from "./networks.js";

function must(document, id) {
  const element = document.getElementById(id);
  if (!element) throw err("err.internal.missingDomNode", { id });
  return element;
}

const NS = "http://www.w3.org/2000/svg";
const PENCIL = "M4 20h4L18 10l-4-4L4 16v4zM13.5 6.5l4 4";
const TRASH = "M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12";

function svgIcon(d) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

function validateBook(book) {
  if (!book || !Array.isArray(book.items)) return { current: "d0", items: [] };
  const items = [];
  for (const item of book.items) {
    if (!item || typeof item !== "object" || typeof item.id !== "string") continue;
    if (!["derived", "watch", "key"].includes(item.kind)) continue;
    if (item.kind === "watch" || item.kind === "key") {
      if (typeof item.address !== "string" || !item.address) continue;
      items.push({
        id: item.id,
        name: typeof item.name === "string" && item.name ? item.name.slice(0, 24) : (item.kind === "key" ? t("account.importedKey") : t("account.watchAddress")),
        kind: item.kind,
        address: item.address,
      });
      continue;
    }
    if (!Number.isInteger(item.account) || item.account < 0) continue;
    items.push({
      id: item.id,
      name: typeof item.name === "string" && item.name ? item.name.slice(0, 24) : t("account.number", { n: item.account + 1 }),
      kind: "derived",
      account: item.account,
      address: typeof item.address === "string" ? item.address : "",
      receiveIndex: Number.isInteger(item.receiveIndex) && item.receiveIndex >= 0 ? item.receiveIndex : 0,
      changeIndex: Number.isInteger(item.changeIndex) && item.changeIndex >= 0 ? item.changeIndex : 0,
      receiveDescriptor: item.receiveDescriptor,
      changeDescriptor: item.changeDescriptor,
      gapLimit: Number.isInteger(item.gapLimit) ? item.gapLimit : 20,
    });
  }
  const current = items.some((item) => item.id === book.current) ? book.current : (items[0]?.id || "d0");
  return { current, items };
}

export function derivedSearchLimit(item, floor = 0) {
  return Math.max(item?.receiveIndex || 0, item?.changeIndex || 0, floor, 20) + 20;
}

export function swapNetworkCursors(items, buckets, fromNetwork, toNetwork) {
  const nextBuckets = { ...(buckets || {}) };
  const from = { ...(nextBuckets[fromNetwork] || {}) };
  for (const item of items || []) {
    if (item?.kind !== "derived") continue;
    from[item.id] = {
      receiveNext: item.receiveIndex || 0,
      changeNext: item.changeIndex || 0,
    };
  }
  nextBuckets[fromNetwork] = from;
  const to = nextBuckets[toNetwork] || {};
  const updated = (items || []).map((item) => {
    if (item?.kind !== "derived") return item;
    const saved = to[item.id];
    return {
      ...item,
      receiveIndex: Number.isInteger(saved?.receiveNext) && saved.receiveNext >= 0 ? saved.receiveNext : 0,
      changeIndex: Number.isInteger(saved?.changeNext) && saved.changeNext >= 0 ? saved.changeNext : 0,
    };
  });
  return { items: updated, buckets: nextBuckets };
}

function watchIdentity(book) {
  return (book?.items || [])
    .filter((item) => item.kind === "watch")
    .map((item) => `${item.id}:${item.address}`)
    .sort()
    .join("\n");
}

function watchRewritten(previous, next) {
  const before = new Map((previous?.items || []).filter((item) => item.kind === "watch").map((item) => [item.id, item.address]));
  return (next?.items || []).some((item) => item.kind === "watch" && (!before.has(item.id) || before.get(item.id) !== item.address));
}

function selectsWatch(previous, next) {
  if (!next || previous?.current === next.current) return false;
  const nextWatch = (next.items || []).some((item) => item.id === next.current && item.kind === "watch");
  if (!nextWatch) return false;
  const removedCurrent = !(next.items || []).some((item) => item.id === previous?.current);
  return !removedCurrent;
}

export function mountShell(document, {
  vault, storage, fetchAddress, fetchUtxos, broadcaster, estimateFees = fetchFeeMenu,
  copyText, drawQr, mainnetStore = null, spendGuard = createSpendGuard({ storage }),
  fetchPearlUsdSpot = null,
  networkPrefs: initialNetworkPrefs = null,
  applyNetworkPrefs = null,
  indexerOrigin = () => "https://blockbook.pearlresearch.ai",
}) {
  const q = (id) => must(document, id);
  const ACTIVITY_DATA_MISSING = packMessage("err.activity.dataMissing");

  function kindBadgeLabel(kind) {
    if (kind === "watch") return t("account.kind.watchPrefix").replace(/\s*·\s*$/, "").trim();
    if (kind === "key") return t("account.kind.keyPrefix").replace(/\s*·\s*$/, "").trim();
    return "";
  }

  function passwordUserMessage(message, fallbackKey) {
    const unpacked = unpackMessage(message || "");
    if (unpacked?.key && /^err\.vault\.(wrongPassword|passwordWrong)/.test(unpacked.key)) {
      return t("toast.passwordWrong");
    }
    const m = message || "";
    if (/密码/.test(m) && (/不正确|错误/.test(m) || m.includes("密码错误"))) return t("toast.passwordWrong");
    const spoken = speak(message);
    return spoken || (fallbackKey ? t(fallbackKey) : "");
  }

  function paintLocaleChrome() {
    applyDom(document);
    const locale = getLocale();
    for (const btn of [q("langEn"), q("langZh")]) {
      const on = btn.dataset.locale === locale;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.classList.toggle("is-active", on);
    }
  }

  async function persistLocale(next) {
    const locale = normalizeLocale(next);
    setLocale(locale);
    paintLocaleChrome();
    paintNetChrome();
    paintRemove();
    paintIdle?.();
    paintFiat?.();
    paintBalance?.();
    paintAccount(currentItem());
    if (Array.isArray(state.rows) && state.rows.length) {
      state.rows = presentActivity(state.rows);
    }
    if (Array.isArray(state.rows)) {
      renderActivity(q("homeTx"), state.rows.slice(0, 4), "screen-home");
      renderActivity(q("activityList"), state.rows, "screen-activity");
    }
    const sendScreen = state.screen === "screen-send";
    if (sendScreen) {
      paintFeesLoading();
      if (state.feeNote) paintFeesReady();
      paintCustomFeeEst();
      syncSendCompose();
      q("toConfirm").textContent = t("action.review");
    }
    try { if (storage.setLocale) await storage.setLocale(locale); } catch {}
  }

  const screens = [...document.querySelectorAll(".screen")];
  let reads = new AbortController();
  let captureDraft = false;
  let draftWrite = Promise.resolve();
  const DRAFT_FORGET = new Set([
    "screen-welcome", "screen-home", "screen-done", "screen-activity", "screen-receive",
    "screen-settings", "screen-privacy", "screen-donate", "screen-rename", "screen-idle",
  ]);
  function beginReads() {
    reads.abort();
    reads = new AbortController();
  }
  function stopReads() {
    reads.abort();
  }
  function readAddress(address) {
    return fetchAddress(address, { signal: reads.signal });
  }
  function setPageInert(on) {
    for (const id of ["topBar", "bottomNav"]) q(id).inert = on;
    const body = document.querySelector(".wallet > .body");
    if (body) body.inert = on;
  }
  const INDEX_FRESH_MS = 60_000;
  const state = {
    screen: "screen-welcome", flow: "create", password: "", mnemonic: "", mnemonicWords: 12, secret: "", fee: "standard",
    rates: { slow: 2, standard: 8, fast: 20 }, feeNote: "", custom: false, draft: null, txid: "",
    book: { current: "d0", items: [] }, hidden: false, busy: false, balance: null,
    rows: [], activityError: "", pendingAdd: "", pendingWatch: "", pendingWatchId: "", idleMin: 5,
    cursorBuckets: {},
    savedBook: { current: "d0", items: [] },
    cursorFresh: Object.create(null),
    homeCache: Object.create(null),
    pearlUsd: null,
    priceStatus: "idle",
    sendMax: false,
    networkPrefs: initialNetworkPrefs ? normalizeNetworkPrefs(initialNetworkPrefs) : defaultNetworkPrefs(),
    netDraft: null,
    netCustomOpen: false,
    idleCustomOpen: false,
  };
  function activeNetwork() {
    return state.networkPrefs.networkId || NETWORK_MAINNET;
  }
  function checkAddress(value) {
    return validatePearlAddress(value, activeNetwork());
  }
  function currentIndexerOrigin() {
    try { return indexerOrigin() || state.networkPrefs.origin; }
    catch { return state.networkPrefs.origin; }
  }

  function clearSecrets() {
    state.password = "";
    state.mnemonic = "";
    state.secret = "";
    for (const id of ["lockPw", "sheetPw", "unlockPw", "seedPw", "oldPw", "newPw", "newPw2", "pw1", "pw2", "removePw"]) {
      const el = document.getElementById(id);
      if (el) el.value = "";
    }
  }

  function show(id) {
    if (state.screen === "screen-secret" && id !== "screen-secret") {
      state.secret = "";
      q("seedGrid").replaceChildren();
      q("seedGrid").hidden = true;
      q("seedReveal").hidden = true;
      q("seedPw").value = "";
      if (q("seedGate")) q("seedGate").hidden = false;
      if (q("seedPanel")) q("seedPanel").hidden = true;
      note("seedError", "");
    }
    if (id === "screen-welcome" && vault.status.exists && !vault.status.unlocked) id = "screen-lock";
    state.screen = id;
    for (const screen of screens) screen.hidden = screen.id !== id;
    q("screen-unlock").hidden = true;
    q("screen-account-pw").hidden = true;
    q("screen-remove").hidden = true;
    const home = id === "screen-home";
    q("topBar").hidden = !home;
    q("bottomNav").hidden = !["screen-home", "screen-activity", "screen-settings", "screen-receive"].includes(id);
    const tab = id === "screen-receive" ? "screen-home" : id;
    document.querySelectorAll("#bottomNav button").forEach((button) => {
      const on = button.dataset.tab === tab;
      button.classList.toggle("active", on);
      if (on) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const scroller = document.querySelector(".body");
    if (scroller) scroller.scrollTop = 0;
    paintRemove();
    sheet(false);
    if (id === "screen-activity") renderActivity(q("activityList"), state.rows, "screen-activity");
    if (id === "screen-settings") paintSettings();
    if (id === "screen-idle") paintIdle();
    if (id === "screen-rename" && currentItem()) q("renameInput").value = currentItem().name;
    rememberDraft();
  }

  function sheet(open) {
    const dialog = q("accountSheet");
    const modal = typeof dialog.showModal === "function";
    if (open) {
      dialog.hidden = false;
      if (modal) {
        if (!dialog.open) dialog.showModal();
        q("accountScrim").hidden = true;
      } else {
        q("accountScrim").hidden = false;
        setPageInert(true);
      }
      return;
    }
    if (modal && dialog.open) dialog.close();
    dialog.hidden = true;
    q("accountScrim").hidden = true;
    setPageInert(false);
  }

  function toast(message) {
    const el = q("toast");
    el.hidden = false;
    el.textContent = message;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 1600);
  }
  function setLockHint(message) {
    const el = q("lockHint");
    el.textContent = message || "";
    el.hidden = !message;
  }
  const invalidFields = {
    pwError: ["pw1", "pw2"],
    importError: ["importText"],
    watchError: ["watchInput"],
    lockError: ["lockPw"],
    whoError: ["sendTo"],
    amtError: ["sendAmount"],
    seedError: ["seedPw"],
    unlockError: ["unlockPw"],
    sheetPwError: ["sheetPw"],
    pwChangeError: ["oldPw", "newPw", "newPw2"],
    removeError: ["removePw"],
  };
  function note(id, message) {
    q(id).textContent = message;
    for (const fieldId of invalidFields[id] || []) {
      const field = q(fieldId);
      if (message) field.setAttribute("aria-invalid", "true");
      else field.removeAttribute("aria-invalid");
    }
  }

  function shake(el) {
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
  }

  function rememberSavedBook() {
    state.savedBook = validateBook(JSON.parse(JSON.stringify(state.book)));
  }
  async function loadBook() {
    state.book = validateBook(await storage.getBook());
    rememberSavedBook();
    if (storage.getIdle) {
      const saved = await storage.getIdle();
      state.idleMin = idleMinutes(saved);
    }
    if (storage.getMeta) {
      try {
        const meta = await storage.getMeta();
        if (meta?.cursorsByNetwork && typeof meta.cursorsByNetwork === "object") {
          state.cursorBuckets = meta.cursorsByNetwork;
          const active = state.cursorBuckets[activeNetwork()] || {};
          for (const item of state.book.items) {
            if (item.kind !== "derived") continue;
            const saved = active[item.id];
            if (!saved) continue;
            if (Number.isInteger(saved.receiveNext) && saved.receiveNext >= 0) item.receiveIndex = saved.receiveNext;
            if (Number.isInteger(saved.changeNext) && saved.changeNext >= 0) item.changeIndex = saved.changeNext;
          }
          rememberSavedBook();
        }
        if (meta?.cursors && typeof meta.cursors === "object") {
          for (const item of state.book.items) {
            const cursor = meta.cursors[item.id];
            if (!cursor || item.kind !== "derived") continue;
            if (Number.isInteger(cursor.receiveNext) && cursor.receiveNext >= 0) {
              item.receiveIndex = Math.max(item.receiveIndex || 0, cursor.receiveNext);
            }
            if (Number.isInteger(cursor.changeNext) && cursor.changeNext >= 0) {
              item.changeIndex = Math.max(item.changeIndex || 0, cursor.changeNext);
            }
          }
        }
      } catch { /* Keep the book when meta is corrupt. */ }
    }
  }
  async function saveBook(password) {
    const next = validateBook(state.book);
    const previous = state.savedBook;
    const watchWrite = watchRewritten(previous, next);
    const watchSelect = selectsWatch(previous, next);
    try {
      if (watchWrite || watchSelect) {
        if (!password) throw new Error(t("unlock.addNeedsPassword"));
        if (!vault.status.unlocked || (watchSelect && !watchWrite)) await ensureUnlockedWithPassword(password);
      }
      if (vault.status.unlocked && typeof vault.noteBook === "function") {
        await vault.noteBook(next, password);
      }
    } catch (error) {
      state.book = validateBook(JSON.parse(JSON.stringify(previous)));
      throw error;
    }
    state.book = next;
    rememberSavedBook();
    const remembered = swapNetworkCursors(state.book.items, state.cursorBuckets, activeNetwork(), activeNetwork());
    state.cursorBuckets = remembered.buckets;
    await storage.setBook(state.book);
    if (storage.getMeta && storage.setMeta) {
      try {
        const meta = (await storage.getMeta()) || {
          schemaVersion: 2,
          activeAccountId: state.book.current,
          idleMinutes: state.idleMin,
          networkId: activeNetwork(),
          vaultGeneration: 1,
        };
        const cursors = { ...(meta.cursors || {}) };
        for (const item of state.book.items) {
          if (item.kind !== "derived") continue;
          cursors[item.id] = {
            receiveNext: item.receiveIndex || 0,
            changeNext: item.changeIndex || 0,
          };
        }
        await storage.setMeta({
          ...meta,
          schemaVersion: 2,
          activeAccountId: state.book.current,
          idleMinutes: state.idleMin,
          networkId: activeNetwork(),
          cursors,
          cursorsByNetwork: state.cursorBuckets,
        });
      } catch { /* A failed public-cursor write does not block the book. */ }
    }
  }
  async function syncBookFromVault() {
    if (!vault.status.unlocked || typeof vault.projectedBook !== "function") return;
    try {
      const projected = validateBook(await vault.projectedBook(state.book.current));
      const byId = new Map(state.book.items.map((item) => [item.id, item]));
      for (const item of projected.items) {
        const prev = byId.get(item.id);
        if (item.kind === "derived" && prev?.kind === "derived") {
          if (prev.name) item.name = prev.name;
          // Different addresses mean the cursors are not for the same chain. Keep the address and cursor already derived locally for the current network.
          if (prev.address && item.address && prev.address !== item.address) {
            if (checkAddress(prev.address).ok) item.address = prev.address;
            item.receiveIndex = prev.receiveIndex || 0;
            item.changeIndex = prev.changeIndex || 0;
          } else {
            item.receiveIndex = Math.max(item.receiveIndex || 0, prev.receiveIndex || 0);
            item.changeIndex = Math.max(item.changeIndex || 0, prev.changeIndex || 0);
          }
        }
      }
      // Until the sealed directory catches up, keep only derived accounts from the local book. An unsealed watch address must not be written back from that book.
      for (const item of state.book.items) {
        if (item.kind === "derived" && !projected.items.some((entry) => entry.id === item.id)) {
          projected.items.push(item);
        }
      }
      state.book = validateBook(projected);
      await saveBook();
    } catch { /* If the directory cannot be read, keep using the book. */ }
  }
  function discoveryPaths(item) {
    const account = item.account ?? 0;
    const receiveEnd = Math.max(0, Number.isInteger(item.receiveIndex) ? item.receiveIndex : 0);
    const changeEnd = Math.max(0, Number.isInteger(item.changeIndex) ? item.changeIndex : 0);
    const paths = [];
    for (let index = 0; index <= receiveEnd; index += 1) paths.push({ branch: 0, index, account });
    for (let index = 0; index <= changeEnd; index += 1) paths.push({ branch: 1, index, account });
    return paths;
  }
  function pushUniqueAddress(list, seen, address) {
    if (!address || typeof address !== "string" || seen.has(address)) return;
    seen.add(address);
    list.push(address);
  }
  async function readPersistedScanAddresses(itemId) {
    if (!itemId || !storage.getMeta) return [];
    try {
      const meta = await storage.getMeta();
      const listed = meta?.homeScan?.[itemId];
      return Array.isArray(listed) ? listed.filter((address) => typeof address === "string" && address) : [];
    } catch {
      return [];
    }
  }
  async function persistScanAddresses(itemId, addresses) {
    if (!itemId || !storage.getMeta || !storage.setMeta || !Array.isArray(addresses)) return;
    try {
      const meta = (await storage.getMeta()) || {};
      const homeScan = { ...(meta.homeScan || {}), [itemId]: [...new Set(addresses.filter(Boolean))] };
      await storage.setMeta({ ...meta, homeScan });
    } catch { /* A failed scan-address write does not block the home screen. */ }
  }
  async function pathForDerivedAddress(item, address, floor = 0) {
    if (!item || item.kind !== "derived" || !vault.address || !address) return null;
    const account = item.account ?? 0;
    const limit = derivedSearchLimit(item, floor);
    for (let index = 0; index <= limit; index += 1) {
      for (const branch of [0, 1]) {
        try {
          if (await vault.address(branch, index, account) === address) {
            return { branch, index, account };
          }
        } catch { /* Skip a path that cannot be derived. */ }
      }
    }
    return null;
  }
  // Home balance, activity, and send UTXOs share one address set, so change does not show up on only one of them.
  async function listWalletPeerAddresses(item) {
    const list = [];
    const seen = new Set();
    pushUniqueAddress(list, seen, item.address);
    const cached = readHomeCache(item.id);
    pushUniqueAddress(list, seen, cached?.receive);
    if (Array.isArray(cached?.scanAddresses)) {
      for (const address of cached.scanAddresses) pushUniqueAddress(list, seen, address);
    }
    for (const address of await readPersistedScanAddresses(item.id)) {
      pushUniqueAddress(list, seen, address);
    }
    if (mainnetStore?.getLatestSpendHintForAddress && item.address) {
      try {
        const hint = await mainnetStore.getLatestSpendHintForAddress(item.address);
        pushUniqueAddress(list, seen, hint?.sourceAddress);
        pushUniqueAddress(list, seen, hint?.changeAddress);
      } catch { /* Continue when the hint is missing. */ }
    }
    if (mainnetStore?.getLatestAddressGroupForAddress && item.address) {
      try {
        const group = await mainnetStore.getLatestAddressGroupForAddress(item.address);
        for (const address of group || []) pushUniqueAddress(list, seen, address);
      } catch { /* If the address group cannot be read, keep the book addresses. */ }
    }
    return list;
  }
  async function resolveWalletCoverage(item, { refresh = false } = {}) {
    if (!item?.address) return { entries: new Map(), addresses: [] };
    if (refresh && item.kind === "derived" && vault.status.unlocked) {
      await refreshIndexes(item, { chains: ["receive", "change"] });
    }
    const peers = await listWalletPeerAddresses(item);
    if (item.kind === "derived" && vault.status.unlocked && vault.address) {
      for (const address of peers) {
        const path = await pathForDerivedAddress(item, address, peers.length);
        if (!path) continue;
        if (path.branch === 0) item.receiveIndex = Math.max(item.receiveIndex || 0, path.index);
        else item.changeIndex = Math.max(item.changeIndex || 0, path.index);
      }
      try { await saveBook(); } catch { /* A failed cursor write does not block the flow. */ }
    }
    const entries = new Map();
    if (item.kind === "derived" && vault.status.unlocked && vault.address) {
      for (const path of discoveryPaths(item)) {
        try {
          entries.set(await vault.address(path.branch, path.index, path.account), path);
        } catch { /* Skip a path that cannot be derived. */ }
      }
      for (const address of peers) {
        if (entries.has(address)) continue;
        const path = await pathForDerivedAddress(item, address, peers.length);
        if (path) entries.set(address, path);
      }
    } else {
      for (const address of peers) entries.set(address, null);
      if (!entries.has(item.address)) entries.set(item.address, null);
    }
    return { entries, addresses: [...entries.keys()] };
  }
  async function mergeWalletActivity(groups, hintAddresses = []) {
    let merged = mergeActivityGroups(groups);
    if (!mainnetStore?.getLatestSpendHintForAddress) return merged;
    const seen = new Set();
    for (const address of hintAddresses) {
      if (!address || seen.has(address)) continue;
      seen.add(address);
      try {
        const hint = await mainnetStore.getLatestSpendHintForAddress(address);
        if (hint) merged = applyLatestSpendHint(merged, hint);
      } catch { /* If the hint is missing, keep the indexer result. */ }
    }
    return merged;
  }
  async function loadWalletSnapshot(item, { refresh = true, extraAddresses = [], persist = true } = {}) {
    const { entries, addresses } = await resolveWalletCoverage(item, { refresh });
    const scan = [...addresses];
    const seen = new Set(scan);
    for (const address of extraAddresses) {
      if (!address || seen.has(address)) continue;
      seen.add(address);
      scan.push(address);
      if (!entries.has(address)) entries.set(address, null);
    }
    const snaps = await Promise.all(scan.map(async (address) => {
      try {
        return { ok: true, address, snap: await readAddress(address) };
      } catch (error) {
        return { ok: false, address, error };
      }
    }));
    if (reads.signal.aborted) throw new DOMException(t("error.queryAborted"), "AbortError");
    const ok = snaps.filter((entry) => entry.ok);
    if (!ok.length) throw snaps[0]?.error || new Error(t("error.queryFailed"));
    let balance = 0n;
    const groups = [];
    let activityError = "";
    for (const entry of ok) {
      balance += entry.snap.balance ?? 0n;
      if (entry.snap.activityError) activityError = entry.snap.activityError;
      groups.push(entry.snap.activity || []);
    }
    const hintAddresses = [item.address, ...scan];
    const rows = presentActivity(await mergeWalletActivity(groups, hintAddresses));
    const receive = (await shownReceiveAddress(item)) || item.address;
    // Preview paints (gap scan still pending) must not overwrite the durable home cache with a partial total.
    if (persist) {
      writeHomeCache(item.id, {
        balance,
        rows,
        activityError,
        receive,
        scanAddresses: scan,
      });
      await persistScanAddresses(item.id, scan);
    }
    state.balance = balance;
    state.rows = rows;
    state.activityError = activityError;
    return { balance, rows, activityError, receive, scanAddresses: scan, entries };
  }
  async function collectSendUtxos(item) {
    const { entries, addresses } = await resolveWalletCoverage(item, { refresh: true });
    const collected = [];
    for (const [address, path] of entries) {
      if (!path) continue;
      if (reads.signal.aborted) throw new DOMException(t("error.queryAborted"), "AbortError");
      const found = await fetchUtxos(address, { signal: reads.signal, network: activeNetwork() });
      for (const utxo of found) collected.push({ ...utxo, address, path });
    }
    return { collected, addresses };
  }
  async function cacheHomeAfterSpend(item, draft, txid) {
    if (!item?.id || !draft) return;
    const extras = [];
    const seenExtras = new Set();
    pushUniqueAddress(extras, seenExtras, draft.sourceAddress);
    pushUniqueAddress(extras, seenExtras, draft.changeAddress);
    for (const input of draft.inputs || []) pushUniqueAddress(extras, seenExtras, input.address);
    let balance = 0n;
    let rows = [];
    let activityError = "";
    let receive = item.address;
    let scan = extras;
    try {
      const snapshot = await loadWalletSnapshot(item, { refresh: false, extraAddresses: extras });
      balance = snapshot.balance;
      rows = snapshot.rows;
      activityError = snapshot.activityError;
      receive = snapshot.receive;
      scan = snapshot.scanAddresses;
    } catch { /* When the indexer lags, fall back to the local send hint. */ }
    let merged = rows.map((row) => ({
      txid: row.txid,
      direction: row.direction,
      amount: row.amount,
      confirmations: row.confirmations,
      time: row.time,
    }));
    const lower = typeof txid === "string" ? txid.toLowerCase() : "";
    if (lower && !merged.some((row) => row.txid === lower)) {
      const payment = typeof draft.payment === "bigint" ? draft.payment : BigInt(draft.payment);
      merged = [{
        txid: lower,
        direction: "out",
        amount: payment,
        confirmations: 0,
        time: Math.floor(Date.now() / 1000),
      }, ...merged];
    } else if (lower && draft.payment != null) {
      try {
        merged = applyLatestSpendHint(merged, {
          txid: lower,
          payment: String(draft.payment),
          fee: String(draft.fee ?? 0),
        });
      } catch { /* ignore */ }
    }
    rows = presentActivity(merged);
    writeHomeCache(item.id, {
      balance,
      rows,
      activityError,
      receive: receive || item.address,
      scanAddresses: scan,
    });
    await persistScanAddresses(item.id, scan);
    state.balance = balance;
    state.rows = rows;
    state.activityError = activityError;
  }
  function currentItem() {
    return state.book.items.find((item) => item.id === state.book.current) || state.book.items[0] || null;
  }
  function pretty(grains, { compact = false } = {}) {
    const raw = compact ? formatGrainsCompact(grains) : formatGrains(grains);
    const neg = raw.startsWith("-");
    const body = neg ? raw.slice(1) : raw;
    const [whole, fraction] = body.split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${neg ? "-" : ""}${fraction ? `${grouped}.${fraction}` : grouped}`;
  }
  function money(grains) {
    const n = typeof grains === "bigint" ? grains : BigInt(grains);
    return `${pretty(n)} PEARL`;
  }
  function moneyCompact(grains) {
    const n = typeof grains === "bigint" ? grains : BigInt(grains);
    return `${pretty(n, { compact: true })} PEARL`;
  }
  // The send-page fee cards estimate a fixed 180 vB. The review page settles the fee from the real vsize.
  const FEE_ESTIMATE_VB = 180n;
  function feeEstimateLabel(rateGrainPerVb) {
    const grains = BigInt(rateGrainPerVb) * FEE_ESTIMATE_VB;
    return t("fee.estimate", { amount: formatGrains(grains) });
  }
  function feeRateLabel(rateGrainPerVb) {
    return t("fee.rate", { rate: Number(rateGrainPerVb) });
  }
  function ago(unix) {
    if (unix == null) return t("time.notInBlock");
    const delta = Math.max(0, Math.floor(Date.now() / 1000 - unix));
    if (delta < 60) return t("time.justNow");
    if (delta < 3600) return t("time.minutesAgo", { n: Math.floor(delta / 60) });
    if (delta < 86400) return t("time.hoursAgo", { n: Math.floor(delta / 3600) });
    return t("time.daysAgo", { n: Math.floor(delta / 86400) });
  }
  function shortAddr(address) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }
  function addressReady() {
    const value = q("sendTo").value.trim();
    if (!value) {
      note("whoError", "");
      q("whoOk").hidden = true;
      return false;
    }
    const parsed = checkAddress(value);
    if (parsed.ok) {
      note("whoError", "");
      q("whoOk").hidden = false;
      return true;
    }
    q("whoOk").hidden = true;
    note("whoError", spokenAddress(parsed.error));
    return false;
  }
  function amountReady() {
    const amount = q("sendAmount").value.trim().replace(/,/g, "");
    if (!amount) {
      if (!state.sendMax) note("amtError", "");
      return false;
    }
    if (state.sendMax) {
      note("amtError", "");
      return state.balance != null;
    }
    if (!/^(?:\d+|\d+\.\d{1,8})$/.test(amount)) {
      note("amtError", t("send.amtDecimals"));
      return false;
    }
    try {
      const grains = parsePrlAmount(amount);
      if (state.balance != null && grains > state.balance) {
        note("amtError", t("send.insufficient"));
        return false;
      }
      note("amtError", "");
      return true;
    } catch {
      note("amtError", t("send.amtDecimals"));
      return false;
    }
  }
  function syncSendCompose() {
    const ok = addressReady() && amountReady();
    q("toConfirm").disabled = !ok;
  }
  function sendAmountValue() {
    return state.sendMax ? "MAX" : q("sendAmount").value.trim().replace(/,/g, "");
  }
  function paintFeesLoading() {
    const fees = document.querySelector(".fees");
    fees?.classList.add("is-loading");
    fees?.setAttribute("aria-busy", "true");
    q("feeNote").textContent = t("fee.loadingNote");
    for (const name of ["slow", "standard", "fast"]) {
      const card = q(`fee-${name}`);
      card.querySelector("[data-fee-est]").textContent = t("fee.querying");
      card.querySelector("[data-fee-rate]").textContent = "·";
    }
  }
  function paintFeesReady() {
    const fees = document.querySelector(".fees");
    fees?.classList.remove("is-loading");
    fees?.removeAttribute("aria-busy");
    q("feeNote").textContent = state.feeNote;
    for (const name of ["slow", "standard", "fast"]) {
      const card = q(`fee-${name}`);
      const rate = state.rates[name];
      card.querySelector("[data-fee-est]").textContent = feeEstimateLabel(rate);
      card.querySelector("[data-fee-rate]").textContent = feeRateLabel(rate);
    }
  }
  function fillAddress(el, address) {
    el.replaceChildren();
    const groups = address.match(/.{1,4}/g) || [];
    groups.forEach((group, index) => {
      const piece = document.createElement("b");
      if (index < 2 || index >= groups.length - 2) piece.className = "edge";
      piece.textContent = group;
      el.append(piece);
    });
  }
  function spokenAddress(error) {
    if (!error) return "";
    const unpacked = unpackMessage(error);
    if (unpacked?.key?.startsWith("err.addr.")) {
      if (unpacked.key === "err.addr.mixedCase") return t("addr.mixedCase");
      if (unpacked.key === "err.addr.checksum") return t("addr.checksum");
      if (unpacked.key === "err.addr.badChars") return t("addr.badChars");
      if (unpacked.key === "err.addr.hrpMismatch") {
        return activeNetwork() === NETWORK_TESTNET ? t("addr.wrongNetworkTestnet") : t("addr.wrongNetworkMainnet");
      }
      if (unpacked.key === "err.addr.enterFirst") return t("addr.enterFirst");
      return speak(error);
    }
    if (error.includes("大小写")) return t("addr.mixedCase");
    if (error.includes("校验失败") || error.includes("手打")) return t("addr.checksum");
    if (error.includes("字符")) return t("addr.badChars");
    if (error.includes("网络")) {
      return activeNetwork() === NETWORK_TESTNET ? t("addr.wrongNetworkTestnet") : t("addr.wrongNetworkMainnet");
    }
    if (error.includes("请输入")) return t("addr.enterFirst");
    return t("addr.invalid");
  }

  function vaultAlreadyUnlocked(error) {
    if (!(error instanceof Error)) return false;
    const unpacked = unpackMessage(error.message);
    if (unpacked?.key === "err.vault.alreadyUnlocked") return true;
    return error.message.includes("已经解锁");
  }

  function renderWords(target, words, masked) {
    const grid = q(target);
    grid.replaceChildren();
    words.forEach((word, index) => {
      const span = document.createElement("span");
      const mark = document.createElement("b");
      mark.textContent = String(index + 1);
      span.append(mark, document.createTextNode(masked ? "••••" : word));
      grid.append(span);
    });
    grid.hidden = false;
  }

  function arrowIcon(direction) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", direction === "up" ? "M12 19V5M7 10l5-5 5 5" : "M12 5v14M7 14l5 5 5-5");
    svg.append(path);
    return svg;
  }

  function activityRow(tx, back) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `tx ${tx.direction}`;
    const icon = document.createElement("i");
    icon.className = `mark ${tx.direction}`;
    icon.append(arrowIcon(tx.direction === "out" ? "up" : "down"));
    const main = document.createElement("div");
    main.className = "body-copy";
    const title = document.createElement("div");
    title.className = "t";
    title.textContent = tx.title;
    const when = document.createElement("div");
    when.className = "s";
    when.textContent = `${ago(tx.time)} · ${tx.confirmLabel}`;
    main.append(title, when);
    const amt = document.createElement("div");
    amt.className = `amt ${tx.direction}`;
    const sign = tx.direction === "out" ? "−" : tx.direction === "in" ? "+" : "";
    const num = document.createElement("span");
    num.className = "n";
    num.textContent = `${sign}${pretty(tx.amount, { compact: true })}`;
    const unit = document.createElement("span");
    unit.className = "u";
    unit.textContent = "PEARL";
    amt.append(num, unit);
    row.append(icon, main, amt);
    row.addEventListener("click", () => openTx(tx, back));
    return row;
  }

  function emptyGlyph() {
    const glyph = document.createElement("div");
    glyph.className = "activity-empty-glyph";
    glyph.setAttribute("aria-hidden", "true");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M8 7h8M8 12h8M8 17h5M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z");
    svg.append(path);
    glyph.append(svg);
    return glyph;
  }

  function statusLine(target, message, action, options = {}) {
    const rich = options.rich === true || target.id === "activityList";
    const box = document.createElement("div");
    box.className = rich ? "activity-empty" : "empty";
    if (rich) box.append(emptyGlyph());
    if (rich) {
      const title = document.createElement("strong");
      title.textContent = options.title || t("activity.empty.title");
      box.append(title);
    }
    const text = document.createElement("p");
    text.textContent = message;
    box.append(text);
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = rich ? "btn ghost" : "btn text";
      button.textContent = action.label;
      button.addEventListener("click", action.onClick);
      box.append(button);
    }
    target.replaceChildren(box);
  }

  function renderActivity(target, rows, back) {
    target.replaceChildren();
    if (!rows.length) {
      const failed = state.activityError && state.activityError !== ACTIVITY_DATA_MISSING;
      const onActivity = target.id === "activityList";
      statusLine(
        target,
        failed
          ? speak(state.activityError)
          : onActivity
            ? t("activity.empty.hint")
            : t("activity.empty.noRecords"),
        failed
          ? null
          : onActivity
            ? { label: t("activity.action.receive"), onClick: () => q("goReceive").click() }
            : back === "screen-home"
              ? { label: t("activity.action.receive"), onClick: () => q("goReceive").click() }
              : null,
        onActivity ? { rich: true, title: failed ? t("activity.empty.failedTitle") : t("activity.empty.title") } : {},
      );
      return;
    }
    for (const tx of rows) target.append(activityRow(tx, back));
  }

  function paintFiat() {
    const el = q("homeFiat");
    const spot = q("homeSpot");
    if (!el) return;
    if (state.hidden) {
      el.hidden = false;
      el.textContent = "••••";
      if (spot) { spot.hidden = false; spot.textContent = "••••"; }
      return;
    }
    const hasPrice = Boolean(state.pearlUsd?.amount);
    const waiting = state.balance == null
      || state.priceStatus === "loading"
      || (state.priceStatus === "idle" && !hasPrice);
    if (waiting) {
      el.hidden = false;
      el.textContent = t("home.fiat.loading");
      if (spot) { spot.hidden = true; spot.textContent = ""; }
      return;
    }
    if (!hasPrice || state.priceStatus === "error") {
      el.hidden = false;
      el.textContent = t("home.fiat.noQuote");
      if (spot) { spot.hidden = true; spot.textContent = ""; }
      return;
    }
    try {
      el.hidden = false;
      el.textContent = formatUsdTotal(state.balance, state.pearlUsd);
      if (spot) {
        spot.hidden = false;
        spot.textContent = formatSpotCaption(state.pearlUsd, { prefix: t("home.spotPrefix") });
      }
    } catch {
      el.hidden = false;
      el.textContent = t("home.fiat.noQuote");
      if (spot) { spot.hidden = true; spot.textContent = ""; }
    }
  }
  function paintBalance() {
    const button = q("hideBalance");
    button.setAttribute("aria-pressed", state.hidden ? "true" : "false");
    button.setAttribute("aria-label", state.hidden ? t("home.showBalance") : t("home.hideBalance"));
    const eyeOn = button.querySelector(".eye-on");
    const eyeOff = button.querySelector(".eye-off");
    if (eyeOn && eyeOff) {
      eyeOn.hidden = state.hidden;
      eyeOff.hidden = !state.hidden;
    }
    const el = q("homeBalance");
    if (state.hidden) {
      el.textContent = "••••";
      el.classList.remove("skel");
      paintFiat();
      return;
    }
    if (state.balance == null) {
      el.textContent = t("home.balance.loading");
      el.classList.add("skel");
      paintFiat();
      return;
    }
    el.classList.remove("skel");
    el.textContent = pretty(state.balance, { compact: true });
    paintFiat();
  }
  const PRICE_FRESH_MS = 60_000;
  let priceRefreshSeq = 0;
  async function refreshPearlUsd() {
    if (typeof fetchPearlUsdSpot !== "function") {
      state.pearlUsd = null;
      state.priceStatus = "error";
      paintFiat();
      return null;
    }
    if (state.pearlUsd?.amount && Date.now() - (state.pearlUsd.at || 0) < PRICE_FRESH_MS) {
      state.priceStatus = "ready";
      paintFiat();
      return state.pearlUsd;
    }
    const seq = ++priceRefreshSeq;
    state.priceStatus = "loading";
    paintFiat();
    try {
      const spot = await fetchPearlUsdSpot({ signal: reads.signal });
      if (seq !== priceRefreshSeq || reads.signal.aborted) return null;
      state.pearlUsd = {
        amount: spot.amount,
        scaled: spot.scaled,
        scale: spot.scale,
        source: spot.source,
        at: Date.now(),
      };
      state.priceStatus = "ready";
      paintFiat();
      return state.pearlUsd;
    } catch (error) {
      if (error?.name === "AbortError" || reads.signal.aborted || seq !== priceRefreshSeq) {
        if (seq === priceRefreshSeq && state.priceStatus === "loading" && !state.pearlUsd?.amount) {
          state.priceStatus = "idle";
        }
        return null;
      }
      if (!state.pearlUsd?.amount) {
        state.pearlUsd = null;
        state.priceStatus = "error";
      } else {
        state.priceStatus = "ready";
      }
      paintFiat();
      return state.pearlUsd;
    }
  }

  function paintAccount(item) {
    q("switchName").textContent = item?.name || t("account.default");
    const kind = q("accountKind");
    const limit = q("sendLimit");
    const sendable = item?.kind === "derived";
    q("goSend").disabled = !sendable;
    if (item?.kind === "watch") {
      kind.hidden = false;
      kind.textContent = kindBadgeLabel("watch");
      limit.hidden = false;
      limit.textContent = t("home.limit.watch");
    } else if (item?.kind === "key") {
      kind.hidden = false;
      kind.textContent = kindBadgeLabel("key");
      limit.hidden = false;
      limit.textContent = t("home.limit.key");
    } else {
      kind.hidden = true;
      kind.textContent = "";
      limit.hidden = true;
      limit.textContent = "";
    }
  }

  function paintRemove() {
    const label = q("removeVault").querySelector(".row-label");
    if (label) label.textContent = t("settings.removeVault");
  }
  function activeNetProfile(prefs = state.networkPrefs) {
    if (prefs.indexerMode === "custom") return "custom";
    return prefs.networkId === NETWORK_TESTNET ? "testnet" : "mainnet";
  }
  function paintNetChrome() {
    const profile = activeNetProfile();
    const short = profile === "custom" ? t("net.custom") : profile === "testnet" ? t("net.testnet") : t("net.mainnet");
    const hint = q("netRowHint");
    if (hint) hint.textContent = short;
    const badge = q("settingsNetBadge");
    if (badge) badge.textContent = short;
    const homeLabel = q("netDotLabel");
    if (homeLabel) homeLabel.textContent = short;
    const welcomeLabel = q("welcomeNetLabel");
    if (welcomeLabel) welcomeLabel.textContent = short;
  }
  function openNetwork(from) {
    q("screen-network").querySelector("[data-back]").dataset.back = from;
    state.netDraft = { ...state.networkPrefs };
    state.netCustomOpen = false;
    paintNetworkScreen();
    show("screen-network");
  }
  function paintNetworkScreen() {
    const prefs = state.networkPrefs;
    const draft = state.netDraft || { ...prefs };
    state.netDraft = draft;
    const active = activeNetProfile(prefs);
    for (const button of q("netPresetList").querySelectorAll("[data-profile]")) {
      button.setAttribute("aria-checked", button.dataset.profile === active ? "true" : "false");
    }
    const customOn = prefs.indexerMode === "custom";
    const summary = q("netCustomSummary");
    summary.hidden = !customOn;
    summary.setAttribute("aria-checked", active === "custom" ? "true" : "false");
    if (customOn) {
      q("netCustomTitle").textContent = prefs.networkId === NETWORK_TESTNET ? t("network.customTitleTestnet") : t("network.customTitleMainnet");
      q("netCustomHost").textContent = prefs.origin || `${prefs.host}${prefs.port ? `:${prefs.port}` : ""}`;
    }
    const editing = !!state.netCustomOpen;
    q("netCustomFields").hidden = !editing;
    q("netCustomToggle").textContent = editing ? t("network.collapseCustom") : (customOn ? t("network.editCustom") : t("network.addCustom"));
    for (const button of q("netCustomChainChoices").querySelectorAll("[data-net]")) {
      button.setAttribute("aria-checked", button.dataset.net === draft.networkId ? "true" : "false");
    }
    for (const button of q("netSchemeChoices").querySelectorAll("[data-scheme]")) {
      button.setAttribute("aria-checked", button.dataset.scheme === (draft.scheme || "https") ? "true" : "false");
    }
    if (editing) {
      q("netHost").value = draft.host || "";
      q("netPort").value = draft.port || "";
    }
    const httpHint = q("netHttpHint");
    const showHttp = editing && (draft.scheme || "https") === "http";
    httpHint.hidden = !showHttp;
    httpHint.textContent = showHttp ? t("network.httpCleartext") : "";
    note("netError", "");
  }
  async function commitNetworkDraft(draft) {
    if (typeof applyNetworkPrefs !== "function") throw new Error(t("net.cannotSavePrefs"));
    const prevNetwork = state.networkPrefs.networkId;
    const prevOrigin = state.networkPrefs.origin;
    const next = await applyNetworkPrefs(draft);
    state.networkPrefs = normalizeNetworkPrefs(next);
    state.netDraft = { ...state.networkPrefs };
    const changed = prevNetwork !== state.networkPrefs.networkId || prevOrigin !== state.networkPrefs.origin;
    if (changed) {
      await rederiveAfterNetworkChange({
        chainChanged: prevNetwork !== state.networkPrefs.networkId,
        previousNetwork: prevNetwork,
      });
    }
    paintNetChrome();
    note("netError", "");
    if (!vault.status.unlocked && vault.status.exists && prevNetwork !== state.networkPrefs.networkId) {
      toast(t("toast.networkSwitchLocked"));
      show("screen-lock");
      return;
    }
    if (prevNetwork !== state.networkPrefs.networkId) {
      toast(t("toast.networkRederived"));
    } else if (state.networkPrefs.indexerMode === "custom") {
      toast(t("toast.networkCustomSaved"));
    } else {
      toast(t("toast.networkSwitched"));
    }
    const back = q("screen-network").querySelector("[data-back]")?.dataset.back;
    if (!vault.status.exists) {
      show(back === "screen-welcome" ? "screen-welcome" : "screen-settings");
      return;
    }
    if (back === "screen-home" && (vault.status.unlocked || currentItem()?.address)) {
      await openHome();
      return;
    }
    show("screen-settings");
    if (vault.status.unlocked || currentItem()?.address) await openHome();
  }
  function donationConfigured() {
    return typeof DONATION_ADDRESS === "string" && /^prl1[a-z0-9]+$/i.test(DONATION_ADDRESS.trim());
  }
  function paintDonateScreen() {
    const address = donationConfigured() ? DONATION_ADDRESS.trim() : "";
    q("donateBlurb").textContent = t("donate.blurb");
    q("donateAddress").textContent = address || t("donate.noAddress");
    q("copyDonate").disabled = !address;
    q("donateHint").textContent = t("donate.hint");
  }
  function paintSettings() {
    const idle = q("idleValue");
    if (idle) idle.textContent = t("idle.value", { min: state.idleMin });
    paintNetChrome();
    paintRemove();
  }
  async function rederiveAfterNetworkChange({ chainChanged = true, previousNetwork = "" } = {}) {
    clearHomeCache();
    clearCursorFresh();
    if (!chainChanged) {
      await saveBook();
      return;
    }
    const swapped = swapNetworkCursors(state.book.items, state.cursorBuckets, previousNetwork || activeNetwork(), activeNetwork());
    state.cursorBuckets = swapped.buckets;
    state.book.items = swapped.items;
    if (!vault.status.unlocked) {
      // Derivation requires an unlock. Clear derived addresses so an old-chain address is not shown on the new indexer.
      for (const item of state.book.items) {
        if (item.kind === "derived") item.address = "";
      }
      state.book.items = state.book.items.filter((item) => (
        item.kind === "derived" || (item.address && checkAddress(item.address).ok)
      ));
      if (!state.book.items.some((item) => item.id === state.book.current)) {
        state.book.current = state.book.items[0]?.id || "d0";
      }
      await saveBook();
      return;
    }
    for (const item of state.book.items) {
      if (item.kind !== "derived") continue;
      item.address = await vault.address(0, 0, item.account);
    }
    const kept = [];
    for (const item of state.book.items) {
      if (item.kind === "derived") { kept.push(item); continue; }
      if (item.address && checkAddress(item.address).ok) kept.push(item);
    }
    state.book.items = kept;
    if (!kept.some((item) => item.id === state.book.current)) {
      state.book.current = kept[0]?.id || "d0";
    }
    await saveBook();
  }

  function openTx(tx, back, network = activeNetwork()) {
    const amount = typeof tx.amount === "bigint" ? tx.amount : BigInt(tx.amount || 0);
    state.txView = {
      txid: String(tx.txid || "").toLowerCase(),
      direction: tx.direction === "in" || tx.direction === "out" ? tx.direction : "self",
      amount: (amount < 0n ? -amount : amount).toString(),
      time: Number.isInteger(tx.time) ? tx.time : null,
      confirmations: Number.isInteger(tx.confirmations) ? tx.confirmations : null,
      back: back === "screen-home" ? "screen-home" : "screen-activity",
      network,
    };
    q("screen-tx").querySelector("[data-back]").dataset.back = state.txView.back;
    q("txTitle").textContent = tx.title;
    const hero = q("txHero");
    hero.classList.remove("in", "out", "self");
    hero.classList.add(tx.direction === "in" || tx.direction === "out" || tx.direction === "self" ? tx.direction : "self");
    const mark = q("txMark");
    mark.replaceChildren(arrowIcon(tx.direction === "out" ? "up" : "down"));
    const sign = tx.direction === "out" ? "−" : tx.direction === "in" ? "+" : "";
    q("txAmount").textContent = `${sign}${pretty(tx.amount)}`;
    q("txState").textContent = tx.confirmDetail || tx.confirmLabel;
    q("txWhen").textContent = tx.time == null ? t("time.notInBlock") : `${ago(tx.time)} · ${tx.timeLabel}`;
    const txidText = String(tx.txid || "").trim().toLowerCase();
    q("txId").textContent = tx.txid;
    const viewTxDetail = q("viewTxDetail");
    const explorerUrl = explorerTxUrl(state.txView.network, txidText);
    viewTxDetail.hidden = !explorerUrl;
    if (explorerUrl) viewTxDetail.dataset.url = explorerUrl;
    else delete viewTxDetail.dataset.url;
    show("screen-tx");
  }

  async function openHome() {
    beginReads();
    if (vault.status.unlocked) await syncBookFromVault();
    if (!currentItem() && vault.status.unlocked) {
      try { await ensureDerived(0); } catch { /* With no account list yet, use the derived address from the unlock. */ }
    }
    let item = currentItem();
    if (item?.kind === "derived" && vault.status.unlocked && (!item.address || !checkAddress(item.address).ok)) {
      try {
        item.address = await vault.address(0, 0, item.account);
        await saveBook();
      } catch { /* The empty check below still runs. */ }
      item = currentItem();
    }
    if (item?.address && !checkAddress(item.address).ok) {
      if (!vault.status.unlocked && vault.status.exists) {
        toast(t("toast.networkMismatch"));
        show("screen-lock");
        return;
      }
    }
    if (!item) {
      show(vault.status.unlocked ? "screen-home" : (vault.status.exists ? "screen-lock" : "screen-welcome"));
      return;
    }
    if (!item.address) {
      state.balance = null;
      state.rows = [];
      paintBalance();
      q("switchAddr").textContent = "";
      q("homeAddr").textContent = "";
      paintAccount(item);
      show("screen-home");
      statusLine(q("homeTx"), vault.status.unlocked
        ? t("home.status.noAddress")
        : t("home.status.networkUnlock"), {
        label: vault.status.unlocked ? t("action.retry") : t("action.unlock"),
        onClick: () => {
          if (vault.status.unlocked) openHome();
          else show("screen-lock");
        },
      });
      q("homeBalance").classList.remove("skel");
      q("homeBalance").textContent = state.hidden ? "••••" : t("home.balance.unknown");
      return;
    }
    q("switchAddr").textContent = shortAddr(item.address || "");
    q("homeAddr").textContent = item.address || "";
    paintAccount(item);
    const cached = readHomeCache(item.id);
    const hasCache = applyHomeCache(cached);
    if (!hasCache) {
      state.balance = null;
      state.rows = [];
      state.activityError = "";
      paintBalance();
      renderActivity(q("homeTx"), [], "screen-home");
    }
    show("screen-home");
    // Cache first when present. Balance paints before gap rescan and before the USD quote.
    setHomeSoftRefresh(hasCache);
    const derivedRefresh = item.kind === "derived" && vault.status.unlocked;
    const paintHomeSnapshot = (snapshot) => {
      q("switchAddr").textContent = shortAddr(snapshot.receive);
      q("homeAddr").textContent = snapshot.receive;
      paintBalance();
      q("availLine").textContent = t("home.avail", { amount: pretty(snapshot.balance) });
      renderActivity(q("homeTx"), snapshot.rows.slice(0, 4), "screen-home");
    };
    try {
      // Cold open: known receive/change addresses only, so the PEARL total appears before a full gap scan.
      // When a gap rescan will follow, skip persisting the preview so a mid-scan close cannot leave a partial total.
      if (!hasCache) {
        const quick = await loadWalletSnapshot(item, { refresh: false, persist: !derivedRefresh });
        if (reads.signal.aborted || currentItem()?.id !== item.id) return;
        paintHomeSnapshot(quick);
        setHomeSoftRefresh(derivedRefresh);
      }
      // Quote after balance is on screen; fiat stays on "loading" until the spot returns.
      void refreshPearlUsd();
      if (derivedRefresh) {
        const snapshot = await loadWalletSnapshot(item, { refresh: true });
        if (reads.signal.aborted || currentItem()?.id !== item.id) return;
        paintHomeSnapshot(snapshot);
      } else if (hasCache) {
        const snapshot = await loadWalletSnapshot(item, { refresh: false });
        if (reads.signal.aborted || currentItem()?.id !== item.id) return;
        paintHomeSnapshot(snapshot);
      }
      setHomeSoftRefresh(false);
    } catch (error) {
      setHomeSoftRefresh(false);
      if (error?.name === "AbortError" || reads.signal.aborted) return;
      if (hasCache || state.balance != null) {
        toast(speak(error) || t("toast.refreshFailBalance"));
        return;
      }
      q("homeBalance").classList.remove("skel");
      q("homeBalance").textContent = state.hidden ? "••••" : t("home.balance.unknown");
      paintFiat();
      statusLine(q("homeTx"), t("home.status.queryFailNotZero", { message: speak(error) || t("error.queryFailed") }), {
        label: t("action.retry"),
        onClick: () => { openHome(); },
      });
    }
  }

  async function openActivity() {
    const item = currentItem();
    show("screen-activity");
    if (!item?.address) {
      statusLine(q("activityList"), t("home.noAddressList"));
      return;
    }
    renderActivity(q("activityList"), state.rows || [], "screen-activity");
    beginReads();
    try {
      const snapshot = await loadWalletSnapshot(item, {
        refresh: item.kind === "derived" && vault.status.unlocked,
      });
      if (reads.signal.aborted || currentItem()?.id !== item.id) return;
      paintBalance();
      q("availLine").textContent = t("home.avail", { amount: pretty(snapshot.balance) });
      renderActivity(q("activityList"), snapshot.rows, "screen-activity");
    } catch (error) {
      if (error?.name === "AbortError" || reads.signal.aborted) return;
      if (state.rows?.length) {
        toast(speak(error) || t("toast.activityRefreshFail"));
        return;
      }
      statusLine(q("activityList"), `${speak(error) || t("error.queryFailed")}`, {
        label: t("action.retry"),
        onClick: () => { openActivity(); },
      });
    }
  }

  async function ensureDerived(account) {
    if (!vault.status.unlocked) throw new Error(t("unlock.required"));
    const address = await vault.address(0, 0, account);
    let item = state.book.items.find((entry) => entry.kind === "derived" && entry.account === account);
    if (!item) {
      item = {
        id: `d${account}`, name: t("account.number", { n: account + 1 }), kind: "derived", account, address,
        receiveIndex: 0, changeIndex: 0, gapLimit: 20,
      };
      state.book.items.push(item);
    } else item.address = address;
    if (typeof vault.describe === "function") {
      try {
        const described = await vault.describe(account);
        item.receiveDescriptor = described.receiveDescriptor;
        item.changeDescriptor = described.changeDescriptor;
      } catch { /* Descriptors are optional. */ }
    }
    state.book.current = item.id;
    await saveBook();
    return item;
  }

  function askPassword(kind) {
    state.pendingAdd = kind;
    sheet(false);
    q("sheetPw").value = "";
    note("sheetPwError", "");
    q("screen-account-pw").hidden = false;
  }

  // Sensitive actions go through here: verify the password when already unlocked, otherwise unlock. Do not treat "already unlocked" as a wrong password.
  async function ensureUnlockedWithPassword(password) {
    if (vault.status.unlocked && typeof vault.verifyPassword === "function") {
      await vault.verifyPassword(password);
      return;
    }
    try {
      await vault.unlock(password);
    } catch (error) {
      if (!(error instanceof Error && vaultAlreadyUnlocked(error))) throw error;
      if (typeof vault.verifyPassword === "function") await vault.verifyPassword(password);
    }
  }

  async function bookDriftedFromVault() {
    if (typeof vault.directory !== "function") return false;
    try {
      const directory = await vault.directory();
      const have = new Set((directory.accounts || []).map((account) => account.account));
      return state.book.items.some((item) => item.kind === "derived" && !have.has(item.account));
    } catch { return false; }
  }
  async function persistBookIfDrifted(password) {
    if (!await bookDriftedFromVault()) return;
    if (typeof vault.noteBook === "function") {
      await vault.noteBook(state.book);
      return;
    }
    if (!password || typeof vault.commitBook !== "function") return;
    await vault.commitBook(password, state.book);
  }
  async function smallerHasHistory(account) {
    const item = state.book.items.find((entry) => entry.kind === "derived" && entry.account === account);
    const receiveEnd = Math.max(0, item?.receiveIndex || 0);
    const changeEnd = Math.max(0, item?.changeIndex || 0);
    const paths = [];
    for (let index = 0; index <= receiveEnd; index += 1) paths.push([0, index]);
    for (let index = 0; index <= changeEnd; index += 1) paths.push([1, index]);
    if (!paths.length) paths.push([0, 0]);
    for (const [branch, index] of paths) {
      try {
        if (reads.signal.aborted) throw new DOMException(t("error.queryAborted"), "AbortError");
        const snap = await readAddress(await vault.address(branch, index, account));
        if (addressLooksUsed(snap)) return true;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
      }
    }
    return false;
  }
  async function previousAccountsLackHistory() {
    const used = state.book.items.filter((item) => item.kind === "derived").map((item) => item.account);
    const next = used.length ? Math.max(...used) + 1 : 0;
    for (let account = 0; account < next; account += 1) {
      if (!await smallerHasHistory(account)) return true;
    }
    return false;
  }
  function showAddAccountWarn() {
    q("screen-add-account").hidden = false;
  }
  function hideAddAccountWarn() {
    q("screen-add-account").hidden = true;
  }
  async function beginDerived({ skipWarn = false } = {}) {
    if (!skipWarn && await previousAccountsLackHistory()) {
      showAddAccountWarn();
      return;
    }
    hideAddAccountWarn();
    await finishDerived();
  }
  async function finishDerived() {
    const used = state.book.items.filter((item) => item.kind === "derived").map((item) => item.account);
    const next = used.length ? Math.max(...used) + 1 : 0;
    const previous = state.book.current;
    const created = !state.book.items.some((entry) => entry.kind === "derived" && entry.account === next);
    let item;
    try {
      item = await ensureDerived(next);
      if (typeof vault.noteBook !== "function") {
        if (!state.password || typeof vault.commitBook !== "function") throw new Error(t("unlock.addNeedsPassword"));
        await vault.commitBook(state.password, state.book);
      }
    } catch (error) {
      if (created && item) {
        state.book.items = state.book.items.filter((entry) => entry.id !== item.id);
        state.book.current = state.book.items.some((entry) => entry.id === previous) ? previous : (state.book.items[0]?.id || "d0");
        try { await saveBook(); } catch { /* If rolling the book back fails, still throw the original error. */ }
      }
      throw error;
    }
    state.password = "";
    await openHome();
    toast(t("toast.accountAdded"));
  }

  function paintImportKind(kind) {
    const next = kind === "hex" ? "hex" : "mnemonic";
    q("importKind").value = next;
    q("importTitle").textContent = next === "hex" ? t("import.titleHex") : t("import.titleMnemonic");
    q("importText").placeholder = next === "hex" ? t("import.placeholderHex") : t("import.placeholderMnemonic");
    for (const [id, value] of [["kindMnemonic", "mnemonic"], ["kindHex", "hex"]]) {
      q(id).setAttribute("aria-checked", value === next ? "true" : "false");
    }
  }

  function paintIdle() {
    const preset = isIdlePreset(state.idleMin);
    for (const button of q("idlePresetList").querySelectorAll("[data-idle]")) {
      button.setAttribute("aria-checked", Number(button.dataset.idle) === state.idleMin ? "true" : "false");
    }
    const summary = q("idleCustomSummary");
    summary.hidden = preset;
    summary.setAttribute("aria-checked", preset ? "false" : "true");
    if (!preset) {
      q("idleCustomTitle").textContent = t("idle.value", { min: state.idleMin });
      q("idleCustomHost").textContent = t("idle.customTitle");
    }
    const editing = !!state.idleCustomOpen;
    q("idleCustomFields").hidden = !editing;
    q("idleCustomToggle").textContent = editing
      ? t("idle.customToggleCollapse")
      : (preset ? t("idle.customMinutes") : t("idle.customToggleEdit"));
    if (editing) {
      q("idleCustomMin").value = String(state.idleMin);
    }
    q("idleNote").textContent = t("idle.note", { min: state.idleMin });
    note("idleError", "");
    const idle = q("idleValue");
    if (idle) idle.textContent = t("idle.value", { min: state.idleMin });
  }
  async function commitIdleMinutes(min) {
    const next = idleMinutes(min);
    if (next !== Number(min)) throw new Error(t("idle.rangeError", { min: IDLE_MIN_LIMIT.min, max: IDLE_MIN_LIMIT.max }));
    state.idleMin = next;
    state.idleCustomOpen = false;
    if (storage.setIdle) await storage.setIdle(next);
    paintIdle();
    paintSettings();
    toast(t("toast.idleSaved"));
  }

  async function blockIfVault() {
    const present = vault.status.exists || (await storage.getVault()) != null;
    if (!present) return false;
    state.mnemonic = "";
    state.password = "";
    state.secret = "";
    q("pw1").value = "";
    q("pw2").value = "";
    q("importText").value = "";
    note("verifyError", "");
    q("wordGrid").hidden = true;
    setLockHint(t("lock.hint.resumePassword"));
    void forgetDraft();
    show("screen-lock");
    return true;
  }
  function resetPasswordScreen() {
    q("pw1").type = "password";
    q("pw2").type = "password";
    for (const id of ["togglePw1", "togglePw2"]) {
      q(id).setAttribute("aria-pressed", "false");
      q(id).setAttribute("aria-label", t("password.show"));
    }
    note("pwError", "");
    paintPasswordStrength();
  }
  function paintMnemonicLength() {
    const words = state.mnemonicWords === 24 ? 24 : 12;
    state.mnemonicWords = words;
    for (const button of q("mnemonicLengthChoices").querySelectorAll("[data-words]")) {
      button.setAttribute("aria-checked", Number(button.dataset.words) === words ? "true" : "false");
    }
    q("noticeNote").textContent = t("notice.note", { words });
  }
  function verifyWordIndexes(wordCount) {
    if (wordCount === 24) return [2, 11, 23];
    return [2, 6, 11];
  }
  q("langEn").addEventListener("click", () => { void persistLocale("en"); });
  q("langZh").addEventListener("click", () => { void persistLocale("zh"); });
  q("createWallet").addEventListener("click", async () => {
    state.pendingAdd = "";
    if (await blockIfVault()) return;
    state.flow = "create";
    state.mnemonicWords = 12;
    resetPasswordScreen();
    show("screen-password");
  });
  q("importWallet").addEventListener("click", async () => {
    state.pendingAdd = "";
    if (await blockIfVault()) return;
    state.flow = "import";
    show("screen-import");
  });
  q("watchWallet").addEventListener("click", async () => {
    state.pendingAdd = "";
    if (await blockIfVault()) return;
    state.flow = "watch";
    show("screen-watch");
  });
  document.querySelectorAll("[data-back]").forEach((button) => button.addEventListener("click", () => {
    const target = button.dataset.back;
    // A reopened popup can land on a remembered page before home or activity has loaded.
    // Showing those screens alone leaves the initial "loading" text in place.
    if (target === "screen-home") openHome();
    else if (target === "screen-activity") openActivity();
    else show(target);
  }));
  function paintPasswordStrength() {
    const value = q("pw1").value;
    const length = value.length;
    const mixed = /[A-Za-z]/.test(value) && /\d/.test(value);
    const symbol = /[^A-Za-z0-9]/.test(value);
    const score = !length ? 0 : Math.min(100, Math.round(length / 16 * 70) + (mixed ? 15 : 0) + (symbol ? 15 : 0));
    let level = "empty";
    let text = t("password.strength.empty", { min: MIN_PASSWORD_LENGTH });
    if (length) {
      if (length < MIN_PASSWORD_LENGTH) {
        level = "weak";
        text = t("password.strength.short", { remaining: MIN_PASSWORD_LENGTH - length });
      } else if (isShortUniformPassword(value)) {
        level = "weak";
        text = t("password.strength.uniform", { min: UNIFORM_PASSWORD_MIN_LENGTH });
      } else if (length >= 16 || (length >= 12 && mixed && symbol)) {
        level = "strong";
        text = t("password.strength.strong");
      } else {
        level = "ok";
        text = mixed ? t("password.strength.okMixed") : t("password.strength.okLetters");
      }
    }
    q("meterBar").style.width = `${score}%`;
    q("pwMeter").dataset.level = level;
    const strength = q("strengthText");
    strength.dataset.level = level;
    strength.textContent = text;
  }
  function paintPasswordMatch() {
    const first = q("pw1").value;
    const second = q("pw2").value;
    if (!second) {
      note("pwError", "");
      return;
    }
    note("pwError", first === second ? "" : t("password.mismatch"));
  }
  function bindPasswordToggle(buttonId, inputId) {
    q(buttonId).addEventListener("click", () => {
      const input = q(inputId);
      const button = q(buttonId);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.setAttribute("aria-pressed", show ? "true" : "false");
      button.setAttribute("aria-label", show ? t("password.hide") : t("password.show"));
    });
  }
  bindPasswordToggle("togglePw1", "pw1");
  bindPasswordToggle("togglePw2", "pw2");
  q("pw1").addEventListener("input", () => {
    paintPasswordStrength();
    paintPasswordMatch();
    rememberDraft();
  });
  q("pw2").addEventListener("input", () => {
    paintPasswordMatch();
    rememberDraft();
  });
  q("ackRisk").addEventListener("change", () => rememberDraft());
  q("ackHand").addEventListener("change", () => rememberDraft());
  q("pwNext").addEventListener("click", async () => {
    const first = q("pw1").value;
    const second = q("pw2").value;
    if (first.length < MIN_PASSWORD_LENGTH) {
      note("pwError", t("password.tooShortDot", { min: MIN_PASSWORD_LENGTH }));
      shake(q("pw1"));
      return;
    }
    if (isShortUniformPassword(first)) {
      note("pwError", t("password.uniformShort", { min: UNIFORM_PASSWORD_MIN_LENGTH }));
      shake(q("pw1"));
      return;
    }
    if (first !== second) { note("pwError", t("password.mismatchDot")); shake(q("pw2")); return; }
    // Record the password before awaiting. Otherwise a test or a double click can advance before the password is stored.
    state.password = first;
    note("pwError", "");
    if (await blockIfVault()) return;
    if (state.flow === "create") {
      state.mnemonicWords = 12;
      q("ackRisk").checked = false;
      note("noticeError", "");
      paintMnemonicLength();
      show("screen-notice");
    } else {
      show("screen-import-entry");
    }
  });
  q("mnemonicLengthChoices").addEventListener("click", (event) => {
    const button = event.target.closest("[data-words]");
    if (!button) return;
    state.mnemonicWords = Number(button.dataset.words) === 24 ? 24 : 12;
    paintMnemonicLength();
    rememberDraft();
  });
  q("noticeNext").addEventListener("click", async () => {
    if (await blockIfVault()) return;
    if (!q("ackRisk").checked) { note("noticeError", t("notice.ackRequired")); return; }
    const words = state.mnemonicWords === 24 ? 24 : 12;
    state.mnemonic = generateMnemonic(globalThis.crypto, { words });
    q("wordGrid").hidden = true;
    q("revealWords").hidden = false;
    q("copyWords").disabled = true;
    q("ackHand").checked = false;
    note("wordError", "");
    show("screen-mnemonic");
  });
  q("revealWords").addEventListener("click", () => {
    renderWords("wordGrid", state.mnemonic.split(" "), false);
    q("revealWords").hidden = true;
    q("copyWords").disabled = false;
    rememberDraft();
  });
  q("copyWords").addEventListener("click", () => copyText(state.mnemonic).then(() => {
    toast(t("toast.copiedClipboardClear"));
    setTimeout(() => {
      copyText("").catch(() => {});
    }, 30000);
  }));
  function paintVerifyScreen() {
    const words = state.mnemonic.split(" ");
    const indexes = verifyWordIndexes(words.length);
    q("verifyHint").textContent = t("verify.hint", { list: indexes.map((i) => i + 1).join(getLocale() === "zh" ? "、" : ", ") });
    const box = q("verifyFields");
    box.replaceChildren();
    const slots = document.createElement("div");
    slots.className = "slots";
    const inputs = [];
    for (const index of indexes) {
      const input = document.createElement("input");
      input.dataset.index = String(index);
      input.hidden = true;
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "slot";
      slot.textContent = t("verify.slot", { n: index + 1 });
      slot.addEventListener("click", () => {
        if (!input.value) return;
        const chip = [...box.querySelectorAll(".chip-word")].find((item) => item.disabled && item.dataset.word === input.value);
        if (chip) chip.disabled = false;
        input.value = "";
        slot.textContent = t("verify.slot", { n: index + 1 });
        slot.classList.remove("filled");
      });
      inputs.push({ input, slot, index });
      slots.append(slot);
      box.append(input);
    }
    box.append(slots);
    const pool = document.createElement("div");
    pool.className = "chips";
    words.map((word, index) => ({ word, index })).sort((a, b) => a.index % 5 - b.index % 5).forEach((item) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip-word";
      chip.dataset.word = item.word;
      chip.textContent = item.word;
      chip.addEventListener("click", () => {
        const next = inputs.find((entry) => !entry.input.value);
        if (!next) return;
        next.input.value = item.word;
        next.slot.textContent = item.word;
        next.slot.classList.add("filled");
        chip.disabled = true;
        note("verifyError", "");
      });
      pool.append(chip);
    });
    box.append(pool);
    note("verifyError", "");
    show("screen-verify");
  }
  q("mnemonicNext").addEventListener("click", async () => {
    if (await blockIfVault()) return;
    if (q("wordGrid").hidden || !q("ackHand").checked) { note("wordError", t("mnemonic.handCopyRequired")); return; }
    paintVerifyScreen();
  });
  q("verifyNext").addEventListener("click", async () => {
    if (await blockIfVault()) return;
    const words = state.mnemonic.split(" ");
    const inputs = [...q("verifyFields").querySelectorAll("input")];
    const wrong = inputs.filter((input) => input.value.trim().toLowerCase() !== words[Number(input.dataset.index)]);
    if (wrong.length) {
      note("verifyError", t("verify.wrong"));
      shake(q("verifyFields"));
      return;
    }
    try {
      await vault.save("mnemonic", state.mnemonic, state.password);
      state.mnemonic = "";
      state.password = "";
      q("pw1").value = "";
      q("pw2").value = "";
      await ensureDerived(0);
      q("doneText").textContent = t("done.created", { name: currentItem().name });
      show("screen-done");
    } catch (error) { note("verifyError", speak(error)); }
  });
  q("chooseMnemonic").addEventListener("click", () => {
    paintImportKind("mnemonic");
    state.flow = "import";
    q("importSeg").hidden = false;
    resetPasswordScreen();
    show("screen-password");
  });
  q("chooseHex").addEventListener("click", () => {
    paintImportKind("hex");
    state.flow = "import";
    q("importSeg").hidden = false;
    resetPasswordScreen();
    show("screen-password");
  });
  q("kindMnemonic").addEventListener("click", () => {
    paintImportKind("mnemonic");
    rememberDraft();
  });
  q("kindHex").addEventListener("click", () => {
    paintImportKind("hex");
    rememberDraft();
  });
  q("importText").addEventListener("input", () => {
    const value = q("importText").value.trim();
    const kind = q("importKind").value;
    if (!value) { note("importError", ""); return; }
    if (kind === "mnemonic") {
      const count = value.split(/\s+/).length;
      note("importError", count === 12 || count === 24 ? "" : t("import.wordCount"));
    } else {
      note("importError", /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0 && value.length >= 32 && value.length <= 128
        ? ""
        : t("import.hexInvalid"));
    }
    rememberDraft();
  });
  q("importNext").addEventListener("click", async () => {
    try {
      if (q("importKind").value === "key") {
        throw new Error(t("import.unsupportedKey"));
      }
      if (vault.status.exists) {
        throw new Error(t("import.vaultExists"));
      }
      await vault.save(q("importKind").value, q("importText").value, state.password);
      await ensureDerived(0);
      q("importText").value = "";
      clearSecrets();
      state.pendingAdd = "";
      await saveBook();
      show("screen-done");
    } catch (error) { note("importError", speak(error)); shake(q("importText")); }
  });
  q("enterWallet").addEventListener("click", () => openHome());
  async function removeWatchAccount(item) {
    if (!item || item.kind !== "watch") return;
    const wasCurrent = state.book.current === item.id;
    state.book.items = state.book.items.filter((entry) => entry.id !== item.id);
    if (wasCurrent) state.book.current = state.book.items[0]?.id || "d0";
    if (item.id && state.homeCache) delete state.homeCache[item.id];
    if (item.id && state.cursorFresh) delete state.cursorFresh[item.id];
    await saveBook();
    toast(t("toast.watchRemoved"));
    if (!state.book.items.length) {
      sheet(false);
      if (vault.status.unlocked) {
        await syncBookFromVault();
        if (state.book.items.length) {
          await openHome();
          return;
        }
      }
      show(vault.status.exists ? (vault.status.unlocked ? "screen-welcome" : "screen-lock") : "screen-welcome");
      return;
    }
    paintAccountSheet();
    if (wasCurrent) await openHome();
  }
  function paintAccountSheet() {
    const list = q("accountList");
    list.replaceChildren();
    for (const item of state.book.items) {
      const row = document.createElement("div");
      row.className = `acct${item.id === state.book.current ? " on" : ""}`;
      const pick = document.createElement("button");
      pick.type = "button";
      pick.className = "acct-main";
      const mark = document.createElement("i");
      if (item.id === state.book.current) mark.append(svgIcon("M5 12.5 10 17l9-10"));
      const name = document.createElement("b");
      name.textContent = item.name;
      const addr = document.createElement("small");
      const kindLabel = item.kind === "watch" ? t("account.kind.watchPrefix") : item.kind === "key" ? t("account.kind.keyPrefix") : "";
      addr.textContent = `${kindLabel}${shortAddr(item.address)}`;
      const meta = document.createElement("span");
      meta.append(name, addr);
      pick.append(mark, meta);
      pick.addEventListener("click", async () => {
        if (item.kind === "watch" && item.id !== state.book.current) {
          state.pendingWatchId = item.id;
          askPassword("select-watch");
          return;
        }
        state.book.current = item.id;
        await saveBook();
        sheet(false);
        await openHome();
      });
      const tools = document.createElement("div");
      tools.className = "acct-tools";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "icon";
      edit.setAttribute("aria-label", t("accounts.renameAria"));
      edit.append(svgIcon(PENCIL));
      edit.addEventListener("click", () => {
        const input = document.createElement("input");
        input.value = item.name;
        input.maxLength = 24;
        input.className = "name-edit";
        input.setAttribute("aria-label", t("accounts.nameAria"));
        meta.replaceChildren(input);
        input.focus();
        input.select();
        let cancel = false;
        const restore = () => meta.replaceChildren(name, addr);
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") { event.preventDefault(); input.blur(); }
          if (event.key === "Escape") { cancel = true; input.blur(); }
        });
        input.addEventListener("blur", async () => {
          if (cancel) { restore(); return; }
          const next = input.value.trim().slice(0, 24);
          if (next) {
            item.name = next;
            name.textContent = next;
            await saveBook();
            if (currentItem()?.id === item.id) q("switchName").textContent = next;
            toast(t("toast.nameSaved"));
          }
          restore();
        });
      });
      tools.append(edit);
      if (item.kind === "watch") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "icon warn";
        remove.setAttribute("aria-label", t("accounts.removeWatchAria"));
        remove.append(svgIcon(TRASH));
        remove.addEventListener("click", async () => {
          if (remove.dataset.armed !== "1") {
            remove.dataset.armed = "1";
            remove.classList.add("armed");
            remove.setAttribute("aria-label", t("accounts.removeWatchConfirmAria"));
            clearTimeout(Number(remove.dataset.timer || 0));
            remove.dataset.timer = String(setTimeout(() => {
              remove.dataset.armed = "";
              remove.classList.remove("armed");
              remove.setAttribute("aria-label", t("accounts.removeWatchAria"));
            }, 4000));
            toast(t("toast.removeWatchConfirm"));
            return;
          }
          clearTimeout(Number(remove.dataset.timer || 0));
          try {
            await removeWatchAccount(item);
          } catch (error) {
            toast(error instanceof Error ? speak(error) : t("toast.removeFailed"));
          }
        });
        tools.append(remove);
      }
      row.append(pick, tools);
      list.append(row);
    }
  }
  q("accountSwitch").addEventListener("click", async () => {
    paintAccountSheet();
    sheet(true);
  });
  q("closeAccounts").addEventListener("click", () => sheet(false));
  q("accountScrim").addEventListener("click", () => sheet(false));
  q("accountSheet").addEventListener("close", () => {
    q("accountSheet").hidden = true;
    q("accountScrim").hidden = true;
    setPageInert(false);
  });
  q("accountSheet").addEventListener("click", (event) => {
    if (event.target === q("accountSheet")) sheet(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!q("screen-add-account").hidden) {
      hideAddAccountWarn();
      return;
    }
    if (!q("accountSheet").hidden) sheet(false);
  });
  q("addDerived").addEventListener("click", async () => {
    try {
      if (!vault.status.unlocked) { askPassword("derived"); return; }
      sheet(false);
      await beginDerived();
    } catch (error) { toast(speak(error)); }
  });
  q("addMenuWatch").addEventListener("click", () => {
    q("screen-watch").querySelector("[data-back]").dataset.back = "screen-home";
    sheet(false);
    show("screen-watch");
  });
  q("closeAddAccount").addEventListener("click", () => hideAddAccountWarn());
  q("cancelAddAccount").addEventListener("click", () => hideAddAccountWarn());
  q("confirmAddAccount").addEventListener("click", async () => {
    if (q("confirmAddAccount").dataset.busy === "1") return;
    q("confirmAddAccount").dataset.busy = "1";
    try {
      await beginDerived({ skipWarn: true });
    } catch (error) {
      toast(error instanceof Error ? speak(error) : t("toast.addFailed"));
    } finally {
      q("confirmAddAccount").dataset.busy = "";
    }
  });
  q("closeAccountPw").addEventListener("click", () => { q("screen-account-pw").hidden = true; });
  q("sheetPwNext").addEventListener("click", async () => {
    const password = q("sheetPw").value;
    try {
      await ensureUnlockedWithPassword(password);
      state.password = password;
      q("sheetPw").value = "";
      note("sheetPwError", "");
      q("screen-account-pw").hidden = true;
      if (state.pendingAdd === "derived") await beginDerived();
      else if (state.pendingAdd === "watch") await finishWatch(password);
      else if (state.pendingAdd === "select-watch") await finishSelectWatch(password);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const spoken = passwordUserMessage(message, "toast.addFailed");
      if (q("screen-account-pw").hidden) toast(spoken);
      else {
        note("sheetPwError", spoken);
        shake(q("screen-account-pw"));
      }
    }
  });
  q("renameAccount").addEventListener("click", async () => {
    const item = currentItem();
    const name = q("renameInput").value.trim();
    if (!item || !name) return;
    item.name = name.slice(0, 24);
    await saveBook();
    q("switchName").textContent = item.name;
    toast(t("toast.renamed"));
  });
  function indexesFresh(item, chains, maxAge = INDEX_FRESH_MS) {
    if (!item?.id) return false;
    const stamp = state.cursorFresh[item.id];
    if (!stamp) return false;
    const now = Date.now();
    return chains.every((chain) => Number.isFinite(stamp[chain]) && now - stamp[chain] < maxAge);
  }
  function markIndexesFresh(item, chains) {
    if (!item?.id || !chains.length) return;
    const stamp = state.cursorFresh[item.id] || Object.create(null);
    const now = Date.now();
    for (const chain of chains) stamp[chain] = now;
    state.cursorFresh[item.id] = stamp;
  }
  function clearCursorFresh() {
    state.cursorFresh = Object.create(null);
  }
  function clearHomeCache() {
    // After locking, drop the balance cache but keep the latest scanned addresses, so a missing change address does not turn the balance into 0 after signing.
    const next = Object.create(null);
    for (const [id, cached] of Object.entries(state.homeCache || {})) {
      if (!cached || !Array.isArray(cached.scanAddresses) || !cached.scanAddresses.length) continue;
      next[id] = {
        scanAddresses: [...cached.scanAddresses],
        receive: cached.receive || "",
        at: cached.at || Date.now(),
      };
    }
    state.homeCache = next;
  }
  function readHomeCache(itemId) {
    return itemId ? state.homeCache[itemId] || null : null;
  }
  function writeHomeCache(itemId, payload) {
    if (!itemId) return;
    state.homeCache[itemId] = { ...payload, at: Date.now() };
  }
  function applyHomeCache(cached) {
    if (!cached || cached.balance == null || !Array.isArray(cached.rows)) return false;
    state.balance = cached.balance;
    state.rows = cached.rows;
    state.activityError = cached.activityError || "";
    paintBalance();
    q("availLine").textContent = t("home.avail", { amount: pretty(cached.balance) });
    renderActivity(q("homeTx"), state.rows.slice(0, 4), "screen-home");
    return true;
  }
  function setHomeSoftRefresh(on) {
    q("balanceCard")?.classList.toggle("soft-refresh", Boolean(on));
  }
  async function refreshIndexes(item, options = {}) {
    if (!item || item.kind !== "derived" || !vault.status.unlocked || !vault.address) return item;
    const chains = options.chains || ["receive", "change"];
    const scanned = [];
    const prevReceive = Number.isInteger(item.receiveIndex) ? item.receiveIndex : 0;
    const prevChange = Number.isInteger(item.changeIndex) ? item.changeIndex : 0;
    const gap = item.gapLimit || 20;
    if (chains.includes("receive")) {
      const receive = await scanChain(
        (index) => addressWasUsed(0, index, item.account),
        gap,
        prevReceive,
      );
      if (reads.signal.aborted) throw new DOMException(t("error.queryAborted"), "AbortError");
      item.receiveIndex = receive.next;
      scanned.push("receive");
    }
    if (chains.includes("change")) {
      const change = await scanChain(
        (index) => addressWasUsed(1, index, item.account),
        gap,
        prevChange,
      );
      if (reads.signal.aborted) throw new DOMException(t("error.queryAborted"), "AbortError");
      item.changeIndex = change.next;
      scanned.push("change");
    }
    if (typeof vault.describe === "function") {
      try {
        const described = await vault.describe(item.account ?? 0);
        item.receiveDescriptor = described.receiveDescriptor;
        item.changeDescriptor = described.changeDescriptor;
        item.gapLimit = 20;
      } catch { /* If a descriptor cannot be built, leave the address on the previous cursor. */ }
    }
    await saveBook();
    markIndexesFresh(item, scanned);
    return item;
  }
  async function addressWasUsed(branch, index, account) {
    if (reads.signal.aborted) throw new DOMException(t("error.queryAborted"), "AbortError");
    const snap = await readAddress(await vault.address(branch, index, account));
    if (addressLooksUsed(snap)) return true;
    // Empty addresses may still carry activityError when history JSON is missing. A zero balance and
    // zero tx count means unused — throwing here used to freeze changeIndex at 0 after import.
    if (snap.activityError) {
      const emptyBalance = snap.balance == null || snap.balance === 0n || snap.balance === 0 || snap.balance === "0";
      const emptyTxs = !Number.isInteger(snap.txCount) || snap.txCount === 0;
      if (!(emptyBalance && emptyTxs)) throw new Error(snap.activityError);
    }
    return false;
  }
  async function shownReceiveAddress(item) {
    if (!item) return "";
    const index = item.kind === "derived" && Number.isInteger(item.receiveIndex) ? item.receiveIndex : 0;
    if (item.kind !== "derived" || !vault.status.unlocked) return item.address;
    try { return await vault.address(0, index, item.account ?? 0); }
    catch { return item.address; }
  }
  async function paintReceive(address) {
    state.receiveAddress = address;
    fillAddress(q("recvAddr"), address);
    try {
      await drawQr(q("qr-canvas"), address);
      note("qr-error", "");
    } catch {
      note("qr-error", t("qr.fail"));
    }
  }
  q("goReceive").addEventListener("click", async () => {
    try {
      const item = currentItem();
      // Open the page immediately from the local cursor. Use the cache when home just scanned; otherwise scan only the receive chain in the background.
      const address = await shownReceiveAddress(item);
      show("screen-receive");
      await paintReceive(address);
      if (!item || item.kind !== "derived" || !vault.status.unlocked) return;
      if (indexesFresh(item, ["receive"])) return;
      beginReads();
      const before = state.receiveAddress;
      await refreshIndexes(item, { chains: ["receive"] });
      if (reads.signal.aborted || state.screen !== "screen-receive") return;
      const next = await shownReceiveAddress(item);
      if (next && next !== before) {
        await paintReceive(next);
        toast(t("toast.newReceiveAddr"));
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (q("screen-receive").hidden) show("screen-receive");
      note("qr-error", error instanceof Error ? speak(error) : t("receive.openFail"));
    }
  });
  q("copySwitch").addEventListener("click", async (event) => {
    event.stopPropagation();
    const item = currentItem();
    if (item) copyText((await shownReceiveAddress(item)) || item.address).then(() => toast(t("toast.addressCopied")));
  });
  q("copyRecv").addEventListener("click", () => copyText(state.receiveAddress || currentItem().address).then(() => toast(t("toast.addressCopied"))));
  q("copyTx").addEventListener("click", () => copyText(q("statusDetail").textContent).then(() => toast(t("toast.txidCopied"))));
  q("viewTx").addEventListener("click", () => {
    const url = q("viewTx").dataset.url;
    if (url) openExternal(url, t("toast.openLinkManual"));
  });
  q("copyTxDetail").addEventListener("click", () => copyText(q("txId").textContent).then(() => toast(t("toast.txidCopied"))));
  q("viewTxDetail").addEventListener("click", () => {
    const url = q("viewTxDetail").dataset.url;
    if (url) openExternal(url, t("toast.openLinkManual"));
  });
  q("statusHome").addEventListener("click", () => openHome());
  q("homeActivityAll").addEventListener("click", () => openActivity());
  async function presentSend() {
    const item = currentItem();
    note("whoError", "");
    note("amtError", "");
    note("sendError", "");
    q("whoOk").hidden = true;
    q("availLine").textContent = state.balance == null ? t("home.avail.loading") : t("home.avail", { amount: pretty(state.balance) });
    q("toConfirm").textContent = t("action.review");
    syncSendCompose();
    paintFeesLoading();
    markFeeChoice(state.custom);
    paintCustomFeeEst();
    show("screen-send");
    try { q("sendTo").focus(); } catch { /* The test environment may have no focus. */ }
    if (item?.address) {
      beginReads();
      try {
        const snapshot = await loadWalletSnapshot(item, {
          refresh: item.kind === "derived" && vault.status.unlocked,
        });
        if (!reads.signal.aborted && state.screen === "screen-send" && currentItem()?.id === item.id) {
          q("availLine").textContent = t("home.avail", { amount: pretty(snapshot.balance) });
          syncSendCompose();
        }
      } catch {
        if (state.balance == null) q("availLine").textContent = t("home.avail.unavailable");
      }
    }
    try {
      const fees = await estimateFees();
      state.rates = fees.menu;
      state.feeNote = fees.fallback
        ? t("fee.note.fallback")
        : t("fee.note.live");
    } catch {
      state.feeNote = t("fee.note.fallback");
    }
    if (state.screen === "screen-send") paintFeesReady();
  }
  q("goSend").addEventListener("click", async () => {
    const item = currentItem();
    if (!item || item.kind === "watch") {
      toast(t("toast.watchNoSend"));
      return;
    }
    if (item.kind === "key") {
      toast(t("toast.keyNoSend"));
      return;
    }
    state.sendMax = false;
    await presentSend();
  });
  q("sendTo").addEventListener("input", () => {
    syncSendCompose();
    rememberDraft();
  });
  q("sendTo").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    try { q("sendAmount").focus(); } catch { /* ignore */ }
  });
  q("sendAmount").addEventListener("input", () => {
    state.sendMax = false;
    syncSendCompose();
    rememberDraft();
  });
  q("sendAmount").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!q("toConfirm").disabled) q("toConfirm").click();
  });
  function customRateValue() {
    const raw = q("customRate").value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const rate = Number(raw);
    if (!Number.isInteger(rate) || rate < 1 || rate > 10000) return null;
    return rate;
  }
  function paintCustomFeeEst() {
    const el = q("customFeeEst");
    const rate = customRateValue();
    if (rate == null) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = feeEstimateLabel(rate);
  }
  function markFeeChoice(custom) {
    document.querySelectorAll(".fee").forEach((item) => {
      item.setAttribute("aria-checked", !custom && item.dataset.fee === state.fee ? "true" : "false");
    });
  }
  function selectedRate() {
    if (state.custom) {
      const rate = customRateValue();
      if (rate == null) throw new Error(t("send.customRateRange"));
      return rate;
    }
    return state.rates[state.fee];
  }
  document.querySelectorAll(".fee").forEach((button) => button.addEventListener("click", () => {
    state.fee = button.dataset.fee;
    state.custom = false;
    q("feeCustom").open = false;
    markFeeChoice(false);
    rememberDraft();
  }));
  q("customFee").addEventListener("click", () => {
    if (customRateValue() != null) {
      state.custom = true;
      markFeeChoice(true);
    }
    paintCustomFeeEst();
    rememberDraft();
  });
  q("customRate").addEventListener("input", () => {
    if (!q("customRate").value.trim()) {
      state.custom = false;
      markFeeChoice(false);
    } else {
      state.custom = true;
      markFeeChoice(true);
    }
    paintCustomFeeEst();
    rememberDraft();
  });
  q("maxBtn").addEventListener("click", () => {
    if (state.balance == null) {
      toast(t("send.balanceLoading"));
      return;
    }
    state.sendMax = true;
    q("sendAmount").value = formatGrains(state.balance);
    syncSendCompose();
    rememberDraft();
  });
  q("toConfirm").addEventListener("click", async () => {
    const item = currentItem();
    syncSendCompose();
    const parsed = checkAddress(q("sendTo").value);
    if (!parsed.ok) {
      note("whoError", spokenAddress(parsed.error));
      q("whoOk").hidden = true;
      shake(q("sendTo"));
      show("screen-send");
      return;
    }
    const amount = sendAmountValue();
    if (amount !== "MAX" && !/^(?:\d+|\d+\.\d{1,8})$/.test(amount)) {
      note("amtError", t("send.enterAmountOrMax"));
      shake(q("sendAmount"));
      show("screen-send");
      return;
    }
    if (item.kind === "watch") { note("sendError", t("send.watchNoSend")); show("screen-send"); return; }
    if (item.kind === "key") { note("sendError", t("send.keyNoSendDetail")); show("screen-send"); return; }
    beginReads();
    q("toConfirm").disabled = true;
    q("toConfirm").textContent = t("send.preparing");
    try {
      if (!vault.status.unlocked) throw new Error(t("send.unlockFirst"));
      const { collected } = await collectSendUtxos(item);
      if (collected.length > 100) throw new Error(t("send.utxoCap"));
      if (!collected.length) {
        if (state.balance != null && state.balance > 0n) {
          throw new Error(t("send.balanceNoUtxo"));
        }
        throw new Error(t("send.noUtxo"));
      }
      await spendGuard.assertAvailable(collected);
      const occupied = new Set(collected.map((utxo) => utxo.address).filter(Boolean));
      if (occupied.has(parsed.address)) {
        throw new Error(t("send.selfPay"));
      }
      // Change must avoid the receive address and every address this payment spends, including a UTXO sitting on an older change address.
      let changeIndex = Number.isInteger(item.changeIndex) ? item.changeIndex : 0;
      let change = await vault.address(1, changeIndex, item.account);
      for (let step = 0; step < 40 && (change === parsed.address || occupied.has(change)); step += 1) {
        changeIndex += 1;
        change = await vault.address(1, changeIndex, item.account);
      }
      if (change === parsed.address || occupied.has(change)) {
        throw new Error(t("send.noChangeAddr"));
      }
      if (changeIndex !== (Number.isInteger(item.changeIndex) ? item.changeIndex : 0)) {
        item.changeIndex = changeIndex;
        await saveBook();
      }
      state.draft = buildDraft({
        utxos: collected,
        sourceAddress: item.address,
        sourcePath: { branch: 0, index: 0, account: item.account },
        destination: parsed.address, changeAddress: change, changeIndex,
        amount: sendAmountValue(),
        feeRate: selectedRate(), maxFee: "0.1",
        network: activeNetwork(),
      });
      fillAddress(q("confirmAddr"), state.draft.destination);
      q("confirmAmount").textContent = money(state.draft.payment);
      q("confirmFee").textContent = money(state.draft.fee);
      q("confirmTotal").textContent = money(BigInt(state.draft.payment) + BigInt(state.draft.fee));
      fillAddress(q("confirmChange"), state.draft.changeAddress);
      q("confirmChangeAmt").textContent = money(state.draft.change);
      note("sendError", "");
      q("toConfirm").disabled = false;
      q("toConfirm").textContent = t("action.review");
      show("screen-confirm");
    } catch (error) {
      q("toConfirm").disabled = false;
      q("toConfirm").textContent = t("action.review");
      syncSendCompose();
      if (error?.name === "AbortError") return;
      const message = error instanceof Error ? speak(error) : t("send.draftFail");
      note("sendError", message.includes(t("send.noUtxo")) && state.balance != null && state.balance > 0n
        ? t("send.balanceNoUtxo")
        : message);
      show("screen-send");
    }
  });
  function openUnlockForSend() {
    note("unlockError", "");
    q("screen-unlock").hidden = false;
    try { q("unlockPw").focus(); } catch { /* The test environment may have no focus. */ }
  }
  q("closeUnlock").addEventListener("click", () => { q("screen-unlock").hidden = true; });

  function paintBroadcast(view) {
    const status = ["broadcasting", "broadcast", "failed", "unknown"].includes(view?.status) ? view.status : "unknown";
    const rawId = typeof view?.txid === "string" ? view.txid.trim().toLowerCase() : "";
    const id = /^[0-9a-f]{64}$/.test(rawId) ? rawId : "";
    state.broadcastView = {
      status,
      txid: id,
      confirmations: Number.isInteger(view?.confirmations) && view.confirmations >= 0 ? view.confirmations : null,
      endpoint: typeof view?.endpoint === "string" ? view.endpoint : "",
      failText: id ? "" : (typeof view?.failText === "string" ? view.failText : ""),
      network: typeof view?.network === "string" ? view.network : activeNetwork(),
    };
    state.txid = id;
    q("statusState").textContent = status === "broadcasting" ? t("status.broadcasting")
      : status === "broadcast" ? t("status.sent")
        : status === "failed" ? t("status.failed")
          : t("status.unknown");
    q("statusDetail").textContent = id;
    const card = q("statusCard");
    if (card) card.hidden = !id;
    const viewTx = q("viewTx");
    const explorerUrl = explorerTxUrl(state.broadcastView.network, id);
    viewTx.hidden = !explorerUrl;
    if (explorerUrl) viewTx.dataset.url = explorerUrl;
    else delete viewTx.dataset.url;
    q("bumpConf").hidden = !id;
    q("statusOrb").classList.toggle("is-failed", status === "failed");
    if (status === "broadcasting") q("confText").textContent = t("status.notYetSent");
    else if (state.broadcastView.failText) q("confText").textContent = state.broadcastView.failText;
    else q("confText").textContent = state.broadcastView.confirmations > 0
      ? t("status.confirmCount", { n: state.broadcastView.confirmations })
      : t("status.pendingConfirm");
  }

  async function signAndSend({ password } = {}) {
    if (state.busy) return;
    if (!state.draft) throw new Error(t("send.noDraft"));
    state.busy = true;
    q("confirmSend").disabled = true;
    q("signBtn").disabled = true;
    try {
      if (password == null || password === "") {
        openUnlockForSend();
        return;
      }
      await ensureUnlockedWithPassword(password);
      state.password = password;
      await spendGuard.assertAvailable(state.draft.inputs);
      q("screen-unlock").hidden = true;
      paintBroadcast({ status: "broadcasting" });
      show("screen-status");
      const signed = await vault.signTransaction(state.draft, password);
      const record = await broadcaster.submit({ draft: state.draft, signed, confirmedTxid: signed.txid });
      state.txid = record.txid;
      const spent = currentItem();
      if (record.status === "unknown" || record.status === "broadcast") {
        await spendGuard.pin(state.draft.inputs, { txid: record.txid, status: record.status });
      } else if (record.status === "failed") {
        await spendGuard.releaseTxid(record.txid);
      }
      if (record.status !== "failed" && spent?.kind === "derived" && Number.isInteger(state.draft.changeIndex)) {
        spent.changeIndex = Math.max(spent.changeIndex || 0, state.draft.changeIndex + 1);
        try { await saveBook(); } catch { /* A failed cursor write does not block the result page. */ }
      }
      if (mainnetStore?.rememberLatest) {
        try {
          await mainnetStore.rememberLatest(state.draft.sourceAddress, record.txid, {
            payment: state.draft.payment,
            fee: state.draft.fee,
            sourceAddress: state.draft.sourceAddress,
            changeAddress: state.draft.changeAddress,
          });
        } catch { /* A failed hint index does not block the result page. */ }
      }
      if (record.status !== "failed" && spent) {
        try { await cacheHomeAfterSpend(spent, state.draft, record.txid); }
        catch { /* A failed home-cache write does not block the result page. */ }
      }
      paintBroadcast({
        status: record.status,
        txid: record.txid,
        confirmations: record.confirmations,
        endpoint: record.endpoint || "",
        network: record.network,
      });
      await rememberDraft();
      clearSecrets();
    } catch (error) {
      if (q("screen-status").hidden === false && q("statusDetail").textContent === "") {
        paintBroadcast({ status: "failed", failText: speak(error) });
        await rememberDraft();
      }
      const message = error instanceof Error ? error.message : "";
      const unpacked = unpackMessage(message);
      const needsUnlock = Boolean(
        unpacked?.key && /unlock|password|Password|wrongPassword/i.test(unpacked.key),
      ) || /解锁|密码/.test(speak(error)) || /解锁|密码/.test(message);
      note("unlockError", passwordUserMessage(message, "toast.sendFailed"));
      if (/^[0-9a-f]{64}$/.test(q("statusDetail").textContent) === false) {
        if (needsUnlock || password != null) {
          openUnlockForSend();
          shake(q("screen-unlock"));
        } else {
          toast(passwordUserMessage(message, "toast.sendFailed"));
          show("screen-confirm");
        }
      }
    } finally {
      state.password = "";
      state.busy = false;
      q("confirmSend").disabled = false;
      q("signBtn").disabled = false;
      q("unlockPw").value = "";
    }
  }

  q("confirmSend").addEventListener("click", () => {
    openUnlockForSend();
  });
  q("signBtn").addEventListener("click", () => {
    signAndSend({ password: q("unlockPw").value });
  });
  q("bumpConf").addEventListener("click", async () => {
    const record = await broadcaster.refresh(state.txid);
    paintBroadcast({
      status: record.status,
      txid: state.txid,
      confirmations: record.confirmations,
      endpoint: state.broadcastView?.endpoint || "",
      network: state.broadcastView?.network,
    });
    if (record.status === "broadcast" && record.confirmations > 0) {
      await spendGuard.releaseTxid(state.txid);
    }
    if (record.status === "failed") await spendGuard.releaseTxid(state.txid);
    await rememberDraft();
  });
  q("viewSeed").addEventListener("click", () => {
    note("seedError", "");
    q("seedPw").value = "";
    q("seedGate").hidden = false;
    q("seedPanel").hidden = true;
    q("seedReveal").hidden = true;
    q("seedGrid").hidden = true;
    q("seedGrid").replaceChildren();
    state.secret = "";
    show("screen-secret");
  });
  q("seedUnlock").addEventListener("click", async () => {
    if (q("seedUnlock").dataset.busy === "1") return;
    q("seedUnlock").dataset.busy = "1";
    try {
      const password = q("seedPw").value;
      await ensureUnlockedWithPassword(password);
      const body = await vault.mnemonic(password);
      q("seedPw").value = "";
      if (!body) { note("seedError", t("seed.notMnemonic")); return; }
      state.secret = body;
      note("seedError", "");
      q("seedGate").hidden = true;
      q("seedPanel").hidden = false;
      renderWords("seedGrid", body.split(" "), true);
      q("seedReveal").hidden = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      note("seedError", passwordUserMessage(message, "seed.openFail"));
      shake(q("seedPw"));
    } finally {
      q("seedUnlock").dataset.busy = "";
    }
  });
  q("seedReveal").addEventListener("click", () => {
    if (!state.secret) return;
    renderWords("seedGrid", state.secret.split(" "), false);
    q("seedReveal").hidden = true;
  });
  q("openPw").addEventListener("click", () => { note("pwChangeError", ""); show("screen-pwchange"); });
  q("openIdle").addEventListener("click", () => {
    state.idleCustomOpen = false;
    paintIdle();
    show("screen-idle");
  });
  q("openNet").addEventListener("click", () => openNetwork("screen-settings"));
  q("welcomeNet").addEventListener("click", () => openNetwork("screen-welcome"));
  q("netDot").addEventListener("click", () => openNetwork("screen-home"));
  q("openPrivacy").addEventListener("click", () => show("screen-privacy"));
  q("openDonate").addEventListener("click", () => {
    paintDonateScreen();
    show("screen-donate");
  });
  function openExternal(url, failToast) {
    try {
      if (globalThis.chrome?.tabs?.create) {
        chrome.tabs.create({ url });
        return;
      }
    } catch { /* Outside the extension, fall through to the open below. */ }
    try {
      globalThis.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast(failToast || t("toast.openLinkManual"));
    }
  }
  q("openSite").addEventListener("click", () => {
    openExternal("https://pearla.net", t("toast.openSiteManual"));
  });
  q("openSource").addEventListener("click", () => {
    openExternal("https://github.com/RayMingyuan/pearl-wallet-extends", t("toast.openSourceManual"));
  });
  q("copyDonate").addEventListener("click", async () => {
    if (!donationConfigured()) {
      toast(t("toast.donateNotConfigured"));
      return;
    }
    try {
      await copyText(DONATION_ADDRESS.trim());
      toast(t("toast.donateCopied"));
    } catch {
      toast(t("toast.copyFailManual"));
    }
  });
  q("openRename").addEventListener("click", () => show("screen-rename"));
  q("netPresetList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-profile]");
    if (!button || button.dataset.busy === "1") return;
    const profile = button.dataset.profile;
    if (profile !== "mainnet" && profile !== "testnet") return;
    button.dataset.busy = "1";
    try {
      state.netCustomOpen = false;
      await commitNetworkDraft({
        networkId: profile === "testnet" ? NETWORK_TESTNET : NETWORK_MAINNET,
        indexerMode: "default",
      });
    } catch (error) {
      note("netError", error instanceof Error ? speak(error) : t("net.failSwitch"));
    } finally {
      button.dataset.busy = "";
    }
  });
  q("netCustomSummary").addEventListener("click", async () => {
    if (state.networkPrefs.indexerMode !== "custom") return;
    if (activeNetProfile() === "custom") {
      state.netCustomOpen = true;
      state.netDraft = { ...state.networkPrefs };
      paintNetworkScreen();
      rememberDraft();
      return;
    }
    try {
      await commitNetworkDraft({ ...state.networkPrefs, indexerMode: "custom" });
    } catch (error) {
      note("netError", error instanceof Error ? speak(error) : t("net.failSwitch"));
    }
  });
  q("netCustomToggle").addEventListener("click", () => {
    state.netCustomOpen = !state.netCustomOpen;
    if (state.netCustomOpen) {
      state.netDraft = {
        networkId: state.networkPrefs.networkId || NETWORK_MAINNET,
        indexerMode: "custom",
        scheme: state.networkPrefs.indexerMode === "custom" ? (state.networkPrefs.scheme || "https") : "https",
        host: state.networkPrefs.indexerMode === "custom" ? (state.networkPrefs.host || "") : "",
        port: state.networkPrefs.indexerMode === "custom" ? (state.networkPrefs.port || "") : "",
      };
    }
    paintNetworkScreen();
    rememberDraft();
  });
  q("netCustomChainChoices").addEventListener("click", (event) => {
    const button = event.target.closest("[data-net]");
    if (!button) return;
    state.netDraft = {
      ...(state.netDraft || state.networkPrefs),
      networkId: button.dataset.net,
      indexerMode: "custom",
    };
    paintNetworkScreen();
    rememberDraft();
  });
  q("netSchemeChoices").addEventListener("click", (event) => {
    const button = event.target.closest("[data-scheme]");
    if (!button) return;
    state.netDraft = {
      ...(state.netDraft || state.networkPrefs),
      scheme: button.dataset.scheme,
      indexerMode: "custom",
    };
    paintNetworkScreen();
    rememberDraft();
  });
  q("netHost").addEventListener("input", () => rememberDraft());
  q("netPort").addEventListener("input", () => rememberDraft());
  q("saveNetwork").addEventListener("click", async () => {
    if (q("saveNetwork").dataset.busy === "1") return;
    q("saveNetwork").dataset.busy = "1";
    try {
      const draft = {
        ...(state.netDraft || state.networkPrefs),
        indexerMode: "custom",
        host: q("netHost").value.trim(),
        port: q("netPort").value.trim(),
      };
      state.netCustomOpen = false;
      await commitNetworkDraft(draft);
    } catch (error) {
      note("netError", error instanceof Error ? speak(error) : t("net.failSave"));
    } finally {
      q("saveNetwork").dataset.busy = "";
    }
  });
  q("idlePresetList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-idle]");
    if (!button || button.dataset.busy === "1") return;
    button.dataset.busy = "1";
    try {
      await commitIdleMinutes(Number(button.dataset.idle));
    } catch (error) {
      note("idleError", error instanceof Error ? speak(error) : t("net.failSave"));
    } finally {
      button.dataset.busy = "";
    }
  });
  q("idleCustomSummary").addEventListener("click", () => {
    if (isIdlePreset(state.idleMin)) return;
    state.idleCustomOpen = true;
    paintIdle();
  });
  q("idleCustomToggle").addEventListener("click", () => {
    state.idleCustomOpen = !state.idleCustomOpen;
    paintIdle();
  });
  q("saveIdleCustom").addEventListener("click", async () => {
    if (q("saveIdleCustom").dataset.busy === "1") return;
    q("saveIdleCustom").dataset.busy = "1";
    try {
      const raw = q("idleCustomMin").value.trim();
      const min = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isInteger(min)) {
        throw new Error(t("idle.rangeError", { min: IDLE_MIN_LIMIT.min, max: IDLE_MIN_LIMIT.max }));
      }
      await commitIdleMinutes(min);
    } catch (error) {
      note("idleError", error instanceof Error ? speak(error) : t("net.failSave"));
    } finally {
      q("saveIdleCustom").dataset.busy = "";
    }
  });
  q("lockNow").addEventListener("click", () => { clearSecrets(); vault.lock(); setLockHint(""); show("screen-lock"); });
  function closeRemoveSheet() {
    q("screen-remove").hidden = true;
    q("removePw").value = "";
    note("removeError", "");
  }
  q("removeVault").addEventListener("click", () => {
    closeRemoveSheet();
    q("screen-remove").hidden = false;
    try { q("removePw").focus(); } catch { /* The test environment may have no focus. */ }
  });
  q("closeRemove").addEventListener("click", closeRemoveSheet);
  q("cancelRemove").addEventListener("click", closeRemoveSheet);
  q("confirmRemove").addEventListener("click", async () => {
    if (q("confirmRemove").dataset.busy === "1") return;
    const password = q("removePw").value;
    if (!password) {
      note("removeError", t("settings.removeNeedPassword"));
      shake(q("removePw"));
      return;
    }
    q("confirmRemove").dataset.busy = "1";
    try {
      await ensureUnlockedWithPassword(password);
      await vault.remove(password);
      state.book = { current: "d0", items: [] };
      await saveBook();
      closeRemoveSheet();
      show("screen-welcome");
      toast(t("toast.vaultRemoved"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      note("removeError", passwordUserMessage(message, "settings.removeNeedPassword"));
      shake(q("removePw"));
    } finally {
      q("confirmRemove").dataset.busy = "";
    }
  });
  q("lockUnlock").addEventListener("click", async () => {
    if (q("lockUnlock").dataset.busy === "1") return;
    q("lockUnlock").dataset.busy = "1";
    try {
      const password = q("lockPw").value;
      if (!vault.status.unlocked) await vault.unlock(password);
      note("lockError", "");
      await syncBookFromVault();
      await persistBookIfDrifted(password);
      q("lockPw").value = "";
      state.password = "";
      await resumeDraftOrHome();
    } catch (error) {
      if (error instanceof Error && vaultAlreadyUnlocked(error)) {
        note("lockError", "");
        q("lockPw").value = "";
        state.password = "";
        await syncBookFromVault();
        await resumeDraftOrHome();
        return;
      }
      const message = error instanceof Error ? error.message : "";
      note("lockError", passwordUserMessage(message, "seed.openFail"));
      shake(q("lockCard"));
    } finally {
      q("lockUnlock").dataset.busy = "";
    }
  });
  q("changePw").addEventListener("click", async () => {
    const current = q("oldPw").value;
    const next = q("newPw").value;
    const again = q("newPw2").value;
    if (next.length < MIN_PASSWORD_LENGTH) {
      note("pwChangeError", t("pwchange.newTooShort", { min: MIN_PASSWORD_LENGTH }));
      shake(q("newPw"));
      return;
    }
    if (isShortUniformPassword(next)) {
      note("pwChangeError", t("password.uniformShort", { min: UNIFORM_PASSWORD_MIN_LENGTH }));
      shake(q("newPw"));
      return;
    }
    if (next !== again) { note("pwChangeError", t("pwchange.mismatch")); shake(q("newPw2")); return; }
    if (next === current) { note("pwChangeError", t("pwchange.sameAsCurrent")); shake(q("newPw")); return; }
    try {
      await vault.changePassword(current, next);
      note("pwChangeError", "");
      clearSecrets();
      toast(t("toast.passwordUpdated"));
      show("screen-settings");
    } catch (error) {
      note("pwChangeError", error instanceof Error ? speak(error) : t("pwchange.fail"));
      shake(q("oldPw"));
    }
  });
  async function finishWatch(password) {
    const parsed = checkAddress(state.pendingWatch);
    if (!parsed.ok) throw new Error(spokenAddress(parsed.error));
    const id = `w${Date.now()}`;
    state.book.items.push({ id, name: t("account.watchAddress"), kind: "watch", address: parsed.address });
    state.book.current = id;
    await saveBook(password);
    state.pendingWatch = "";
    q("watchInput").value = "";
    await openHome();
  }
  async function finishSelectWatch(password) {
    const id = state.pendingWatchId;
    if (!state.book.items.some((item) => item.id === id && item.kind === "watch")) return;
    state.book.current = id;
    await saveBook(password);
    state.pendingWatchId = "";
    sheet(false);
    await openHome();
  }
  q("saveWatch").addEventListener("click", () => {
    const parsed = checkAddress(q("watchInput").value);
    if (!parsed.ok) { note("watchError", spokenAddress(parsed.error)); return; }
    state.pendingWatch = parsed.address;
    askPassword("watch");
  });
  q("watchInput").addEventListener("input", () => {
    const value = q("watchInput").value.trim();
    if (!value) { note("watchError", ""); rememberDraft(); return; }
    const parsed = checkAddress(value);
    note("watchError", parsed.ok ? "" : spokenAddress(parsed.error));
    rememberDraft();
  });
  document.querySelectorAll("#bottomNav button").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.tab === "screen-home") openHome();
    else if (button.dataset.tab === "screen-activity") openActivity();
    else show(button.dataset.tab);
  }));
  q("hideBalance").addEventListener("click", () => { state.hidden = !state.hidden; paintBalance(); });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.isComposing) return;
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;
    const tag = target.tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return;
    const screen = target.closest(".screen, .sheet-screen");
    if (!screen || screen.hidden) return;
    const button = screen.querySelector(".btn.primary");
    if (!button || button.disabled) return;
    event.preventDefault();
    button.click();
  });
  if (typeof vault.subscribe === "function") {
    vault.subscribe((event) => {
      if (event !== "lock") return;
      stopReads();
      clearSecrets();
      clearCursorFresh();
      clearHomeCache();
      state.balance = null;
      state.rows = [];
      state.activityError = "";
      state.pearlUsd = null;
      state.priceStatus = "idle";
      const quiet = ["screen-status", "screen-welcome", "screen-done", "screen-lock", "screen-password", "screen-notice", "screen-mnemonic", "screen-verify", "screen-import", "screen-import-entry"];
      if (quiet.includes(state.screen)) return;
      setLockHint("");
      show("screen-lock");
    });
  }
  // Closing the popup destroys the page. Hand the unfinished form to the offscreen document first, and leave locking to the idle timer.
  // Otherwise coming back from copying an address or mnemonic drops straight to the home screen.
  if (globalThis.chrome?.runtime?.id && typeof globalThis.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") return;
      rememberDraft();
      stopReads();
    });
    globalThis.addEventListener("pagehide", () => {
      rememberDraft();
      stopReads();
    });
  }

  function collectDraft() {
    const screen = state.screen;
    if (screen === "screen-send" || screen === "screen-confirm") {
      return {
        v: 1,
        at: Date.now(),
        screen: "screen-send",
        flow: "send",
        sendTo: q("sendTo").value,
        sendAmount: q("sendAmount").value,
        sendMax: state.sendMax === true,
        fee: state.fee,
        custom: state.custom === true,
        customRate: q("customRate").value,
      };
    }
    if (screen === "screen-status" && state.broadcastView) {
      const view = state.broadcastView;
      return {
        v: 1, at: Date.now(), screen, flow: "status", status: view.status, txid: view.txid,
        confirmations: view.confirmations, endpoint: view.endpoint, failText: view.failText, network: view.network,
      };
    }
    if (screen === "screen-tx" && state.txView?.txid) {
      const view = state.txView;
      return {
        v: 1, at: Date.now(), screen, flow: "tx", txid: view.txid, direction: view.direction,
        amount: view.amount, time: view.time, confirmations: view.confirmations, back: view.back, network: view.network,
      };
    }
    if (screen === "screen-network" && state.netCustomOpen) {
      const draft = state.netDraft || {};
      return {
        v: 1, at: Date.now(), screen, flow: "network",
        networkId: draft.networkId, scheme: draft.scheme,
        host: q("netHost").value, port: q("netPort").value,
      };
    }
    if (screen === "screen-secret") return { v: 1, at: Date.now(), screen, flow: "secret" };
    if (screen === "screen-pwchange") return { v: 1, at: Date.now(), screen, flow: "pwchange" };
    const setup = screen === "screen-password" || screen === "screen-notice" || screen === "screen-mnemonic"
      || screen === "screen-verify" || screen === "screen-import" || screen === "screen-import-entry"
      || screen === "screen-watch";
    if (!setup) return null;
    const vaultReady = vault.status?.exists === true;
    const keepMnemonic = !vaultReady && (screen === "screen-mnemonic" || screen === "screen-verify");
    return {
      v: 1,
      at: Date.now(),
      screen,
      flow: state.flow === "import" || state.flow === "watch" || state.flow === "create" ? state.flow : "create",
      password: vaultReady ? "" : (state.password || ""),
      mnemonic: keepMnemonic ? state.mnemonic : "",
      mnemonicWords: state.mnemonicWords === 24 ? 24 : 12,
      wordsRevealed: keepMnemonic && q("wordGrid").hidden === false,
      ackRisk: q("ackRisk").checked === true,
      ackHand: q("ackHand").checked === true,
      importKind: q("importKind").value === "hex" ? "hex" : "mnemonic",
      importText: vaultReady ? "" : q("importText").value,
      pw1: vaultReady ? "" : q("pw1").value,
      pw2: vaultReady ? "" : q("pw2").value,
      watchInput: q("watchInput").value,
    };
  }
  function rememberDraft() {
    if (!captureDraft) return Promise.resolve();
    const payload = collectDraft();
    const forget = !payload && (DRAFT_FORGET.has(state.screen) || (state.screen === "screen-network" && !state.netCustomOpen));
    if (!payload && !forget) return draftWrite;
    if (payload && typeof storage.setPopupDraft !== "function") return draftWrite;
    if (!payload && typeof storage.clearPopupDraft !== "function") return draftWrite;
    draftWrite = draftWrite.then(() => (
      payload ? storage.setPopupDraft(payload) : storage.clearPopupDraft()
    )).catch(() => {});
    return draftWrite;
  }
  function forgetDraft() {
    if (typeof storage.clearPopupDraft !== "function") return Promise.resolve();
    draftWrite = draftWrite.then(() => storage.clearPopupDraft()).catch(() => {});
    return draftWrite;
  }
  function canResumeSend() {
    const item = currentItem();
    return !!item && item.kind !== "watch" && item.kind !== "key";
  }
  async function applySendDraft(draft) {
    q("sendTo").value = draft.sendTo || "";
    q("sendAmount").value = draft.sendAmount || "";
    q("customRate").value = draft.customRate || "";
    state.fee = draft.fee === "slow" || draft.fee === "fast" ? draft.fee : "standard";
    state.custom = draft.custom === true;
    state.sendMax = draft.sendMax === true;
    if (q("feeCustom")) q("feeCustom").open = state.custom;
    await presentSend();
  }
  function applySetupDraft(draft) {
    state.flow = draft.flow === "import" || draft.flow === "watch" ? draft.flow : "create";
    state.password = draft.password || "";
    state.mnemonic = draft.mnemonic || "";
    state.mnemonicWords = draft.mnemonicWords === 24 ? 24 : 12;
    q("pw1").value = draft.pw1 || "";
    q("pw2").value = draft.pw2 || "";
    q("ackRisk").checked = draft.ackRisk === true;
    q("ackHand").checked = draft.ackHand === true;
    if (draft.screen === "screen-import" || draft.screen === "screen-import-entry" || draft.screen === "screen-password") {
      paintImportKind(draft.importKind === "hex" ? "hex" : "mnemonic");
    }
    q("importText").value = draft.importText || "";
    q("watchInput").value = draft.watchInput || "";
    paintPasswordStrength();
    paintMnemonicLength();
    if ((draft.screen === "screen-mnemonic" || draft.screen === "screen-verify") && !state.mnemonic) {
      show("screen-notice");
      return;
    }
    if (draft.screen === "screen-mnemonic" || draft.screen === "screen-verify") {
      if (draft.wordsRevealed || draft.screen === "screen-verify") {
        renderWords("wordGrid", state.mnemonic.split(" "), false);
        q("revealWords").hidden = true;
        q("copyWords").disabled = false;
      } else {
        q("wordGrid").replaceChildren();
        q("wordGrid").hidden = true;
        q("revealWords").hidden = false;
        q("copyWords").disabled = true;
      }
      note("wordError", "");
      if (draft.screen === "screen-verify") {
        paintVerifyScreen();
        return;
      }
    }
    if (draft.screen === "screen-import-entry") q("importSeg").hidden = false;
    show(draft.screen);
  }
  function applyPageDraft(draft) {
    if (draft.flow === "status") {
      paintBroadcast(draft);
      show("screen-status");
      return;
    }
    if (draft.flow === "tx") {
      const [row] = presentActivity([{
        txid: draft.txid,
        direction: draft.direction,
        amount: BigInt(draft.amount || "0"),
        time: draft.time,
        confirmations: draft.confirmations,
      }]);
      openTx(row, draft.back, draft.network);
      return;
    }
    if (draft.flow === "network") {
      state.netCustomOpen = true;
      state.netDraft = {
        networkId: draft.networkId,
        indexerMode: "custom",
        scheme: draft.scheme,
        host: draft.host,
        port: draft.port,
      };
      paintNetworkScreen();
      show("screen-network");
      return;
    }
    if (draft.flow === "secret") {
      state.secret = "";
      q("seedPw").value = "";
      q("seedGate").hidden = false;
      q("seedPanel").hidden = true;
      q("seedReveal").hidden = true;
      q("seedGrid").hidden = true;
      q("seedGrid").replaceChildren();
      note("seedError", "");
      show("screen-secret");
      return;
    }
    q("oldPw").value = "";
    q("newPw").value = "";
    q("newPw2").value = "";
    note("pwChangeError", "");
    show("screen-pwchange");
  }
  async function restorePopupDraft(draft, present) {
    if (!draft) return false;
    if (draft.flow === "send") {
      if (!present || !canResumeSend()) {
        await forgetDraft();
        return false;
      }
      if (!vault.status.unlocked) {
        show("screen-lock");
        return true;
      }
      await applySendDraft(draft);
      return true;
    }
    if (draft.flow === "status" || draft.flow === "tx") {
      if (!present) {
        await forgetDraft();
        return false;
      }
      applyPageDraft(draft);
      return true;
    }
    if (draft.flow === "network" || draft.flow === "secret" || draft.flow === "pwchange") {
      if (!present) {
        await forgetDraft();
        return false;
      }
      if (!vault.status.unlocked) {
        show("screen-lock");
        return true;
      }
      applyPageDraft(draft);
      return true;
    }
    if (draft.screen === "screen-watch") {
      q("watchInput").value = draft.watchInput || "";
      show("screen-watch");
      return true;
    }
    if (present) {
      await forgetDraft();
      return false;
    }
    applySetupDraft(draft);
    return true;
  }
  async function resumeDraftOrHome() {
    let raw = null;
    try {
      if (typeof storage.getPopupDraft === "function") raw = await storage.getPopupDraft();
    } catch { raw = null; }
    const draft = sanitizePopupDraft(raw);
    if (draft?.flow === "send" && vault.status.unlocked && canResumeSend()) {
      await applySendDraft(draft);
      return;
    }
    if (draft && vault.status.unlocked && (draft.flow === "status" || draft.flow === "tx" || draft.flow === "network" || draft.flow === "secret" || draft.flow === "pwchange")) {
      applyPageDraft(draft);
      return;
    }
    await openHome();
  }

  const ready = (async () => {
  try {
    if (storage.getLocale) {
      const savedLocale = await storage.getLocale();
      if (savedLocale) setLocale(normalizeLocale(savedLocale));
      else setLocale(DEFAULT_LOCALE);
    } else setLocale(DEFAULT_LOCALE);
    paintLocaleChrome();
  } catch {
    setLocale(DEFAULT_LOCALE);
    paintLocaleChrome();
  }
    try {
      await vault.init();
    } catch (error) {
      if (vault.status.exists) {
        q("boot-state").hidden = true;
        setLockHint(t("lock.hint.vaultReadFailed"));
        note("lockError", speak(error));
        show("screen-lock");
        return;
      }
      throw error;
    }
    await loadBook();
    paintNetChrome();
    let rawDraft = null;
    try {
      if (typeof storage.getPopupDraft === "function") rawDraft = await storage.getPopupDraft();
    } catch { rawDraft = null; }
    const savedDraft = sanitizePopupDraft(rawDraft);
    if (rawDraft && !savedDraft) await forgetDraft();
    q("boot-state").hidden = true;
    let present = vault.status.exists;
    if (!present) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      present = (await storage.getVault()) != null;
    }
    captureDraft = true;
    if (await restorePopupDraft(savedDraft, present)) return;
    if (present) show(vault.status.unlocked ? "screen-home" : "screen-lock");
    else if (currentItem()) show("screen-home");
    else show("screen-welcome");
    if ((vault.status.unlocked || !present) && currentItem()) await openHome();
  })();
  return { ready, state };
}

export { deriveAddress, secretToSeed };
