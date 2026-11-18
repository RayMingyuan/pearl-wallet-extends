const SESSION_KEY = "pearlUnlockedUntil";

export async function handleVaultMessage(message, {
  readVault,
  writeVault,
  removeVault,
  writeSession,
  clearSession,
  ensureOffscreen,
  dispatch,
  now = Date.now,
}) {
  if (message?.target !== "vault") return { ok: false, error: "未知消息" };
  await ensureOffscreen();
  const record = await readVault();
  const response = await dispatch({ ...message, record });
  if (response?.stored?.changed) {
    if (response.stored.record) await writeVault(response.stored.record);
    else await removeVault();
  }
  if (response?.status?.unlocked) await writeSession({ [SESSION_KEY]: now() + (message.idleMs || 300000) });
  else await clearSession();
  return {
    ok: response?.ok === true,
    status: response?.status,
    result: response?.result,
    error: response?.error,
  };
}

export async function handlePopupDraftMessage(message, { ensureOffscreen, dispatch }) {
  if (message?.target !== "popup-draft") return { ok: false, target: "popup-draft", draft: null };
  await ensureOffscreen();
  const response = await dispatch({ target: "popup-draft", op: message.op, draft: message.draft });
  if (response?.target !== "popup-draft" || response.ok !== true) {
    return { ok: false, target: "popup-draft", draft: null };
  }
  return response;
}

async function localGet(key) {
  const got = await chrome.storage.local.get(key);
  return got?.[key] ?? null;
}

async function ensureOffscreen() {
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "在弹窗关闭后继续保管已解锁的种子和未完成的表单，这些内容不写入磁盘。",
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!text.includes("single offscreen")) throw error;
  }
}

function install() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id) return;
    if (message?.target === "popup-draft") {
      handlePopupDraftMessage(message, {
        ensureOffscreen,
        dispatch: (payload) => chrome.runtime.sendMessage({ ...payload, target: "offscreen-draft" }),
      }).then(sendResponse);
      return true;
    }
    if (message?.target !== "vault") return;
    handleVaultMessage(message, {
      readVault: () => localGet("pearlVault"),
      writeVault: (record) => chrome.storage.local.set({ pearlVault: record }),
      removeVault: () => chrome.storage.local.remove("pearlVault"),
      writeSession: (value) => chrome.storage.session.set(value),
      clearSession: () => chrome.storage.session.remove(SESSION_KEY),
      ensureOffscreen,
      dispatch: (payload) => chrome.runtime.sendMessage({ ...payload, target: "offscreen" }),
    }).then(sendResponse);
    return true;
  });
}

if (globalThis.chrome?.runtime?.onMessage) install();
