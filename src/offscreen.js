import { createPopupDraftMemory } from "./popup-draft.js";
import { createVaultSession, dispatchVault } from "./vault-host.js";

const popupDrafts = createPopupDraftMemory();

let session = null;
let sessionNetwork = "Pearl mainnet";

function openSession(idleMs, network = "Pearl mainnet") {
  const next = network || "Pearl mainnet";
  if (!session) {
    session = createVaultSession({ idleMs, network: next });
    sessionNetwork = next;
    session.vault.subscribe((event) => {
      if (event === "lock") chrome.runtime.sendMessage({ target: "vault-lock" }).catch(() => {});
    });
    return session;
  }
  if (sessionNetwork !== next) {
    // Switch networks in place while unlocked, so locking does not force the password to be entered again.
    session.vault.switchNetwork(next);
    sessionNetwork = next;
  }
  return session;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id !== chrome.runtime.id) return;
  if (message?.target === "offscreen-draft") {
    sendResponse(popupDrafts.handle(message));
    return true;
  }
  if (message?.target !== "offscreen") return;
  dispatchVault(openSession(message.idleMs, message.network), message).then(sendResponse);
  return true;
});
