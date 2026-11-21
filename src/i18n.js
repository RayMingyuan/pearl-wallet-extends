import { errorCatalogEn, errorCatalogZh } from "./i18n-errors.js";

export const LOCALE_KEY = "prlLocale";
export const DEFAULT_LOCALE = "en";
export const LOCALES = ["en", "zh"];

const I18N_PREFIX = "i18n:";

/** @type {"en" | "zh"} */
let currentLocale = DEFAULT_LOCALE;

const en = {
  "action.back": "Back",
  "action.close": "Close",
  "action.continue": "Continue",
  "action.save": "Save",
  "action.cancel": "Cancel",
  "action.retry": "Try again",
  "action.unlock": "Unlock",
  "action.all": "All",
  "action.review": "Review",
  "action.copy": "Copy",
  "action.refresh": "Refresh",

  "boot.starting": "The UI is still starting.",

  "nav.assets": "Assets",
  "nav.activity": "Activity",
  "nav.settings": "Settings",

  "top.copyAddress": "Copy current address",
  "net.mainnet": "Mainnet",
  "net.testnet": "Testnet",
  "net.custom": "Custom",

  "welcome.brandAlt": "Pearla — The pearl in your pocket.",
  "welcome.create": "Create new wallet",
  "welcome.importExisting": "I already have a wallet",
  "welcome.watchOnly": "Watch-only wallet",

  "password.title": "Set password",
  "password.stepNote": "Used to unlock on this device. It cannot be recovered if lost and does not replace your recovery phrase.",
  "password.label": "Password",
  "password.confirmLabel": "Confirm password",
  "password.placeholderMin": "At least 8 characters",
  "password.confirmPlaceholder": "Enter again",
  "password.show": "Show password",
  "password.hide": "Hide password",
  "password.strength.empty": "At least {min} characters; longer is better.",
  "password.strength.emptyHint": "At least 8 characters; longer is better.",
  "password.strength.short": "{remaining} more characters needed",
  "password.strength.strong": "Strong",
  "password.strength.okMixed": "OK — a bit longer is safer",
  "password.strength.okLetters": "OK — add letters and numbers",
  "password.strength.uniform": "Add a number or symbol, or use at least {min} characters",
  "password.uniformShort": "Under {min} characters, a password cannot be only letters or only numbers.",
  "password.mismatch": "Passwords do not match",
  "password.mismatchDot": "Passwords do not match.",
  "password.tooShort": "Password must be at least {min} characters.",
  "password.tooShortDot": "Password must be at least {min} characters.",

  "notice.title": "Before you continue",
  "notice.lengthLabel": "Recovery phrase length",
  "notice.lengthGroup": "Recovery phrase length",
  "notice.words12": "12 words",
  "notice.words24": "24 words",
  "notice.note": "These {words} words are the key to your account. If you lose them they cannot be restored. Do not screenshot or share them.",
  "notice.note12": "These 12 words are the key to your account. If you lose them they cannot be restored. Do not screenshot or share them.",
  "notice.ack": "I understand they cannot be recovered for me",
  "notice.ackRequired": "Please confirm you understand the recovery phrase cannot be restored for you.",

  "mnemonic.title": "Write down your recovery phrase",
  "mnemonic.reveal": "Tap to reveal",
  "mnemonic.copyRisky": "Copy (easy to leak)",
  "mnemonic.copyHint": "Copying puts it on the clipboard. Clear it as soon as you are done.",
  "mnemonic.ackHand": "I have written it down by hand",
  "mnemonic.toVerify": "Verify",

  "verify.title": "Tap to verify",
  "verify.hint": "Tap word numbers {list}. Tap again to change a pick.",
  "verify.slot": "Word {n}",
  "verify.wrong": "Those words are wrong. Clear and pick again.",
  "verify.complete": "Finish",

  "import.title": "Import",
  "import.chooseMnemonic": "Recovery phrase",
  "import.chooseHex": "Raw seed",
  "import.oneVaultNote": "This install keeps one recovery phrase or raw seed vault only.",
  "import.titleMnemonic": "Import recovery phrase",
  "import.titleHex": "Import raw seed",
  "import.kindMnemonic": "Recovery phrase",
  "import.kindHex": "Seed",
  "import.placeholderMnemonic": "Words separated by spaces",
  "import.placeholderHex": "Even-length hex seed",
  "import.wordCount": "Recovery phrases are usually 12 or 24 words.",
  "import.hexInvalid": "Seed must be even-length hexadecimal.",

  "watch.title": "Watch-only wallet",
  "watch.sub": "Tracks only the address you paste. Balance and spends reflect net change for that address, not other receive/change addresses under the same seed, so totals may differ from a desktop wallet.",
  "watch.addressLabel": "Address",
  "watch.placeholder": "prl1…",
  "watch.start": "Start watching",

  "done.title": "You're set",
  "done.enter": "Enter wallet",
  "done.created": "{name} is ready.",

  "lock.title": "Locked",
  "lock.placeholder": "Enter password",
  "lock.passwordAria": "Password",
  "lock.unlock": "Unlock",
  "lock.hint.vaultReadFailed": "A wallet exists but could not be read this time. Nothing will be created or overwritten.",
  "lock.hint.resumePassword": "Enter the original password used when you created this wallet. A password that was not saved cannot unlock it.",

  "home.balanceLabel": "Balance",
  "home.hideBalance": "Hide balance",
  "home.showBalance": "Show balance",
  "home.lockNow": "Lock now",
  "home.fiat.loading": "Fetching total value…",
  "home.fiat.noQuote": "No USD quote yet",
  "home.spotPrefix": "Spot",
  "home.balance.loading": "Loading…",
  "home.receive": "Receive",
  "home.send": "Send",
  "home.recentActivity": "Recent activity",
  "home.activityAll": "All",
  "home.avail.loading": "Available balance loading…",
  "home.avail": "Available {amount} PEARL",
  "home.avail.unavailable": "Available balance unavailable",
  "home.limit.watch": "Watch-only: balance and spends exclude other receive/change addresses and may differ from desktop totals. View only — cannot send.",
  "home.limit.key": "Private-key accounts are view-only for now; sending is not available.",

  "receive.title": "Receive",
  "receive.addressLabel": "Receive address",
  "receive.copy": "Copy address",
  "receive.newAddressTitle": "Quick new address — local cache, no chain wait",
  "receive.newAddressAria": "Quick new address from local cache",
  "receive.newAddressScanTitle": "Scan chain for an unused address — slower, more thorough",
  "receive.newAddressScanAria": "Scan chain for an unused address",
  "receive.scanning": "Scanning the chain for an unused address…",
  "receive.scanExhausted": "Could not find an unused receive address in this scan window. Try again shortly.",
  "receive.tempHintLocal": "Temporary from local cache — home still shows your first address.",
  "receive.tempHintScan": "Temporary unused address from chain scan — home still shows your first address.",
  "receive.tempHintPick": "Temporary chosen address — home still shows your first address.",
  "receive.pickAddressTitle": "Choose an existing receive address",
  "receive.pickAddressAria": "Choose an existing receive address",
  "receive.pickTitle": "Choose address",
  "receive.pickHint": "Temporary for this Receive screen only — home still shows your first address.",
  "toast.newReceiveAddrLocal": "Temporary address ready (local)",
  "toast.newReceiveAddrScan": "Temporary unused address ready",
  "toast.receivePicked": "Temporary address selected",
  "settings.receiveAddresses": "Receive addresses",
  "settings.accountStructure": "Account structure",
  "addresses.title": "Receive addresses",
  "addresses.sub": "Known receive addresses for this account. Home always uses the first address; others can be copied here or chosen temporarily on Receive.",
  "addresses.empty": "No receive addresses to show yet.",
  "addresses.tag.default": "Default",
  "addresses.tag.used": "Used",
  "addresses.tag.change": "Change",
  "addresses.tag.index": "#{n}",
  "addresses.unlockRequired": "Unlock the wallet to list derived receive addresses.",
  "addresses.copyAria": "Copy address",
  "structure.title": "Account structure",
  "structure.sub": "Read-only view of this account’s receive and change chains. Home still uses the first receive address. Do not share change addresses for payments.",
  "structure.scan": "Scan chains for used addresses",
  "structure.scanning": "Scanning receive and change chains…",
  "structure.receiveHeading": "Receive",
  "structure.changeHeading": "Change (internal)",
  "structure.changeHint": "Change addresses hold leftover from sends. Prefer not using them as payment destinations.",
  "structure.receiveEmpty": "No receive addresses in the local cursor yet.",
  "structure.changeEmpty": "No change addresses in the local cursor yet.",
  "structure.receiveIndex": "Receive #{n}",
  "structure.changeIndex": "Change #{n}",
  "structure.unlockRequired": "Unlock the wallet to inspect derived account structure.",
  "structure.watchOnly": "Watch-only tracks a single address — there is no HD receive/change tree here.",

  "send.title": "Send",
  "send.progress12": "Send progress 1/2",
  "send.progress22": "Send progress 2/2",
  "send.toLabel": "Recipient address",
  "send.toPlaceholder": "prl1…",
  "send.addressOk": "Address format looks good",
  "send.amountLabel": "Amount",
  "send.amountAria": "Amount",
  "send.amountPlaceholder": "0",
  "send.networkFee": "Network fee",
  "send.fee.slow": "Slow",
  "send.fee.standard": "Standard",
  "send.fee.fast": "Fast",
  "send.fee.etaSlow": "~25 blocks",
  "send.fee.etaStandard": "~10 blocks",
  "send.fee.etaFast": "~1 block",
  "send.customFee": "Custom fee rate",
  "send.customRateLabel": "Grains per byte",
  "send.customRatePlaceholder": "e.g. 8",
  "send.grainHint": "1 PEARL = 100 million grains. You usually do not need to change this.",

  "confirm.title": "Review",
  "confirm.recipient": "Recipient address",
  "confirm.amount": "Amount",
  "confirm.fee": "Network fee",
  "confirm.total": "Total debit",
  "confirm.changeDetails": "Change details (usually ignorable)",
  "confirm.changeAddress": "Change address",
  "confirm.changeAmount": "Change",
  "confirm.signSend": "Sign and send",

  "status.unknown": "Status unknown",
  "status.pendingConfirm": "Awaiting confirmation",
  "status.viewTx": "View transaction",
  "status.backHome": "Back to home",
  "status.broadcasting": "Broadcasting",
  "status.notYetSent": "Not sent yet",
  "status.sent": "Sent",
  "status.failed": "Failed",
  "status.confirmCount": "{n} confirmations",

  "activity.title": "Activity",
  "activity.detailTitle": "Activity",
  "activity.status": "Status",
  "activity.time": "Time",
  "activity.txid": "Transaction ID",
  "activity.time.unknown": "Time unknown",
  "activity.time.pending": "Not in a block yet",
  "activity.title.in": "Received",
  "activity.title.out": "Sent",
  "activity.title.zero": "Net zero",
  "activity.confirm.unconfirmed": "Unconfirmed",
  "activity.confirm.unknown": "Status unknown",
  "activity.confirm.confirmed": "Confirmed",
  "activity.confirm.detailUnknown": "Confirmations unknown",
  "activity.confirm.detailCount": "Confirmed · {n} confirmations",
  "activity.empty.title": "No activity yet",
  "activity.empty.failedTitle": "Cannot load activity",
  "activity.empty.hint": "Records appear here after you receive or send.",
  "activity.empty.noRecords": "No records yet",
  "activity.action.receive": "Receive",

  "settings.title": "Settings",
  "settings.security": "Security",
  "settings.viewSeed": "View recovery phrase",
  "settings.changePassword": "Change password",
  "settings.autoLock": "Auto-lock",
  "settings.wallet": "Wallet",
  "settings.accountName": "Account name",
  "settings.network": "Network",
  "settings.preferences": "Preferences",
  "settings.language": "Language",
  "settings.languageGroup": "Language",
  "settings.about": "About",
  "settings.privacy": "Privacy",
  "settings.supportPearla": "Support Pearla",
  "settings.website": "Website",
  "settings.websiteAria": "Official site — opens pearla.net in a new tab",
  "settings.source": "Source code",
  "settings.sourceAria": "Source — opens GitHub in a new tab",
  "settings.removeVault": "Delete current wallet",
  "settings.removeTitle": "Delete current wallet",
  "settings.removeWarn": "This removes the encrypted wallet from this browser. It cannot be undone. You will need your recovery phrase to restore it.",
  "settings.removePassword": "Password",
  "settings.removeNeedPassword": "Enter your password to delete this wallet.",
  "settings.removeAction": "Delete wallet",

  "lang.english": "English",
  "lang.chinese": "中文",

  "pwchange.title": "Change password",
  "pwchange.current": "Current password",
  "pwchange.new": "New password",
  "pwchange.confirm": "Enter again",
  "pwchange.confirmPlaceholder": "Type again",
  "pwchange.save": "Save new password",
  "pwchange.newTooShort": "New password must be at least {min} characters.",
  "pwchange.mismatch": "New passwords do not match.",
  "pwchange.sameAsCurrent": "New password matches the current one.",
  "pwchange.fail": "Could not change password.",

  "idle.title": "Auto-lock",
  "idle.sub": "Lock after a period of inactivity. Tap a choice to save; takes effect next time you open the wallet.",
  "idle.durationGroup": "Lock duration",
  "idle.min1": "1 minute",
  "idle.min1Hint": "Lock even for short breaks",
  "idle.min5": "5 minutes",
  "idle.min5Hint": "Default",
  "idle.min15": "15 minutes",
  "idle.min15Hint": "Longer session",
  "idle.customSection": "Custom",
  "idle.customTitle": "Custom duration",
  "idle.customMinutes": "Custom minutes",
  "idle.customToggleEdit": "Edit custom duration",
  "idle.customToggleCollapse": "Hide custom form",
  "idle.minutesLabel": "Minutes",
  "idle.minutesPlaceholder": "1–120",
  "idle.note": "Currently {min} minutes. Changes apply the next time you open the wallet.",
  "idle.value": "{min} min",
  "idle.rangeError": "Enter a whole number from {min}–{max}.",

  "network.title": "Network",
  "network.sub": "Tap to switch. Mainnet and testnet addresses differ; custom indexers need an address network before saving.",
  "network.presetGroup": "Preset networks",
  "network.customSection": "Custom",
  "network.customTitle": "Custom network",
  "network.customTitleMainnet": "Custom · Mainnet",
  "network.customTitleTestnet": "Custom · Testnet",
  "network.addCustom": "Add custom network",
  "network.editCustom": "Edit custom network",
  "network.collapseCustom": "Hide custom form",
  "network.addrNetworkLabel": "Address network",
  "network.addrNetworkGroup": "Custom address network",
  "network.schemeLabel": "Protocol",
  "network.schemeGroup": "Protocol",
  "network.httpCleartext": "http sends addresses and signed transactions in the clear. Only 127.0.0.1 or localhost is allowed.",
  "network.hostLabel": "Host",
  "network.hostPlaceholder": "e.g. 127.0.0.1",
  "network.portLabel": "Port",
  "network.portPlaceholder": "Optional",
  "network.saveSwitch": "Save and switch",

  "privacy.title": "Privacy",
  "privacy.p1": "This is Pearla. Public privacy policy: pearla.net/privacy.",
  "privacy.p2": "Recovery phrases, seeds, private keys, and passwords stay on this device, encrypted locally. Sessions only store unlock expiry.",
  "privacy.p3": "Address queries, fee rates, and signed transactions you approve are sent only to the indexer you chose under Network (default blockbook.pearlresearch.ai). Passwords and recovery phrases are not included.",
  "privacy.p4": "Home USD totals try Coinbase PEARL-USD first, then CoinGecko on failure; those requests do not include addresses, balances, or keys.",
  "privacy.p5": "We do not read browsing history or inject APIs into web pages.",

  "donate.title": "Support Pearla",
  "donate.blurb": "Voluntary donations support Pearla maintenance. An address is provided to copy only — no automatic transfers and no send screen.",
  "donate.mainnetAddress": "Mainnet receive address",
  "donate.hint": "After copying, paste on the send screen yourself and verify the address.",
  "donate.copy": "Copy address",
  "donate.noAddress": "No donation address configured",

  "rename.title": "Account name",
  "rename.current": "Current account",
  "rename.save": "Save name",

  "secret.title": "Recovery phrase",
  "secret.gateTitle": "Confirm device password again",
  "secret.gateBody": "The phrase is shown only on this device and is never uploaded.",
  "secret.devicePassword": "Device password",
  "secret.verifyContinue": "Verify and continue",
  "secret.afterShowHint": "Do not screenshot; leave this screen when done.",
  "secret.warnTitle": "Recovery phrase will be shown",
  "secret.warnBody": "Keep others from viewing. Do not screenshot or photograph.",
  "secret.reveal": "Tap to show recovery phrase",
  "secret.clearedOnLeave": "Display is cleared when you leave this page.",

  "accounts.title": "Accounts",
  "accounts.add": "Add account",
  "accounts.addContinue": "Continue adding",
  "accounts.addWatch": "Watch-only wallet",
  "accounts.addHint": "“Add account” derives another under the same phrase without replacing wallets. “Watch-only” tracks one address; balance excludes change and other addresses.",
  "accounts.renameAria": "Rename",
  "accounts.nameAria": "Account name",
  "accounts.removeWatchAria": "Remove watch address",
  "accounts.removeWatchConfirmAria": "Tap again to confirm remove",

  "addAccount.title": "Add account",
  "addAccount.warn": "The previous account has no on-chain activity yet. You can still add one, but if the new account never receives funds, recovery elsewhere may not find this empty account; it remains in the local list.",

  "unlock.title": "Enter password",
  "unlock.password": "Password",
  "unlock.placeholder": "Password",
  "unlock.signSend": "Sign and send",

  "accountPw.title": "Enter password",
  "accountPw.password": "Password",
  "accountPw.placeholder": "Unlock password",

  "account.default": "Account",
  "account.one": "Account 1",
  "account.number": "Account {n}",
  "account.importedKey": "Imported key",
  "account.watchAddress": "Watch address",
  "account.kind.watchPrefix": "Watch · ",
  "account.kind.keyPrefix": "Key · ",

  "time.notInBlock": "Not in a block yet",
  "time.justNow": "Just now",
  "time.minutesAgo": "{n} min ago",
  "time.hoursAgo": "{n} h ago",
  "time.daysAgo": "{n} d ago",

  "fee.loadingNote": "Fetching network fees…",
  "fee.querying": "Loading…",
  "fee.estimate": "≈ {amount} PEARL",
  "fee.rate": "{rate} grain/vB",
  "fee.selected": "{rate} grain/vB · ≈ {amount} PEARL",
  "fee.note.live": "Rates come from the network. The amount above is an estimate; the review screen is final.",
  "fee.note.fallback": "Network rates are unavailable right now, so presets are shown. The review screen is final.",
  "fee.note.tied": "The network is quiet, so Standard and Slow currently share the same rate.",

  "send.amtDecimals": "Amount supports at most 8 decimal places.",
  "send.insufficient": "Insufficient balance.",
  "send.enterAmountOrMax": "Enter an amount or tap All.",
  "send.preparing": "Preparing…",
  "send.customRateRange": "Enter a whole number from 1 to 10000.",
  "send.balanceLoading": "Balance still loading — try again shortly",
  "send.watchNoSend": "Watch-only addresses cannot sign or send.",
  "send.keyNoSend": "Standalone key accounts cannot send yet. Use a phrase-derived account.",
  "send.keyNoSendDetail": "Change paths for imported keys are not verified against official import rules; sending is blocked. Use a phrase-derived account.",
  "send.unlockFirst": "Unlock before sending",
  "send.noDraft": "No draft to send.",
  "send.noUtxo": "No confirmed, mature UTXOs available",
  "send.balanceNoUtxo": "Balance is visible but no confirmed spendable UTXOs yet (change may still be syncing). Try again later.",
  "send.utxoCap": "More than 100 spendable UTXOs — consolidate first, then send",
  "send.selfPay": "Recipient is an address this account is spending; use a different address.",
  "send.noChangeAddr": "No usable change address — try again later",
  "send.draftFail": "Could not prepare draft.",

  "addr.mixedCase": "Do not mix upper and lower case.",
  "addr.checksum": "Address does not match — paste the full string.",
  "addr.badChars": "Contains invalid characters.",
  "addr.wrongNetworkTestnet": "This is not a testnet address.",
  "addr.wrongNetworkMainnet": "This is not a mainnet address.",
  "addr.enterFirst": "Enter a recipient address first.",
  "addr.invalid": "This address does not look valid.",

  "home.status.noAddress": "No address available yet — try again soon.",
  "home.status.networkUnlock": "Network changed — unlock to refresh addresses.",
  "home.status.queryFailNotZero": "{message} Not treated as zero.",
  "home.noAddressList": "No address available yet.",

  "toast.copied": "Copied",
  "toast.copiedClipboardClear": "Copied. Clipboard will be cleared in ~30 seconds",
  "toast.addressCopied": "Address copied",
  "toast.txidCopied": "Transaction ID copied",
  "toast.donateCopied": "Donation address copied",
  "toast.copyFailManual": "Copy failed — select the address manually",
  "toast.nameSaved": "Name saved",
  "toast.renamed": "Renamed",
  "toast.accountAdded": "Account added",
  "toast.watchRemoved": "Watch address removed",
  "toast.removeWatchConfirm": "Tap again to remove this watch address",
  "toast.removeFailed": "Could not remove",
  "toast.addFailed": "Could not add",
  "toast.passwordWrong": "Wrong password — try again",
  "toast.idleSaved": "Saved — takes effect next open",
  "toast.networkSwitchLocked": "Network switched — addresses update after unlock",
  "toast.networkRederived": "Network switched — addresses re-derived",
  "toast.networkCustomSaved": "Saved and switched to custom network",
  "toast.networkSwitched": "Switched to selected network",
  "toast.refreshFailBalance": "Refresh failed — showing last balance",
  "toast.activityRefreshFail": "Activity refresh failed — showing last data",
  "toast.networkMismatch": "Current address does not match the selected network — unlock and refresh",
  "toast.newReceiveAddr": "Showing a temporary receive address",
  "toast.watchNoSend": "Watch-only cannot sign or send.",
  "toast.keyNoSend": "Key accounts cannot send yet — use a derived account.",
  "toast.removeVaultConfirm": "Tap “Delete current wallet” again to confirm.",
  "toast.vaultRemoved": "Current wallet deleted.",
  "toast.passwordUpdated": "Password updated",
  "toast.donateNotConfigured": "Donation address not configured",
  "toast.openLinkManual": "Open the link manually",
  "toast.openSiteManual": "Open the website manually",
  "toast.openSourceManual": "Open the source repo manually",
  "toast.sendFailed": "Could not send.",
  "toast.qrFail": "QR generation failed — copy the address.",

  "qr.fail": "QR generation failed — copy the address.",

  "net.failSwitch": "Could not switch network",
  "net.failSave": "Could not save",
  "net.cannotSavePrefs": "Cannot save network settings",

  "import.unsupportedKey": "Private key import is not supported. Use a recovery phrase, raw seed, or watch-only for an external address.",
  "import.vaultExists": "This install keeps one phrase vault. Use Add account for the same seed, or delete the current wallet first.",

  "seed.notMnemonic": "This vault is not a recovery phrase.",
  "seed.openFail": "Could not open right now.",

  "unlock.required": "Unlock first",
  "unlock.addNeedsPassword": "Enter the current vault password before adding an account.",

  "home.balance.unknown": "Unknown",
  "mnemonic.handCopyRequired": "Reveal the phrase and confirm you wrote it down.",
  "receive.openFail": "Could not open receive.",

  "external.manualLink": "Open the link manually",

  "error.queryFailed": "Query failed",
  "error.queryAborted": "Query cancelled",
};

Object.assign(en, errorCatalogEn);

const zh = {
  "action.back": "返回",
  "action.close": "关闭",
  "action.continue": "继续",
  "action.save": "保存",
  "action.cancel": "取消",
  "action.retry": "再试一次",
  "action.unlock": "去解锁",
  "action.all": "全部",
  "action.review": "核对",
  "action.copy": "复制",
  "action.refresh": "刷新",

  "boot.starting": "界面还在启动。",

  "nav.assets": "资产",
  "nav.activity": "活动",
  "nav.settings": "设置",

  "top.copyAddress": "复制当前地址",
  "net.mainnet": "主网",
  "net.testnet": "测试网",
  "net.custom": "自定义",

  "welcome.brandAlt": "Pearla 掌上明珠 — The pearl in your pocket.",
  "welcome.create": "创建新钱包",
  "welcome.importExisting": "我已有钱包",
  "welcome.watchOnly": "观察者钱包",

  "password.title": "设置密码",
  "password.stepNote": "用于本机解锁。丢失无法找回，也不能代替助记词。",
  "password.label": "密码",
  "password.confirmLabel": "确认密码",
  "password.placeholderMin": "至少 8 位",
  "password.confirmPlaceholder": "再输入一次",
  "password.show": "显示密码",
  "password.hide": "隐藏密码",
  "password.strength.empty": "至少 {min} 位，建议更长一些。",
  "password.strength.emptyHint": "至少 8 位，建议更长一些。",
  "password.strength.short": "还差 {remaining} 位",
  "password.strength.strong": "强度较好",
  "password.strength.okMixed": "可用，再长一点更稳妥",
  "password.strength.okLetters": "可用，建议加字母和数字",
  "password.strength.uniform": "请加上数字或符号，或至少写 {min} 位",
  "password.uniformShort": "不足 {min} 位时，不能只用字母或只用数字。",
  "password.mismatch": "两次密码不一致",
  "password.mismatchDot": "两次密码不一致。",
  "password.tooShort": "密码至少 {min} 位。",
  "password.tooShortDot": "密码至少 {min} 位。",

  "notice.title": "先看清楚",
  "notice.lengthLabel": "助记词长度",
  "notice.lengthGroup": "助记词长度",
  "notice.words12": "12 个词",
  "notice.words24": "24 个词",
  "notice.note": "这 {words} 个词就是账户的钥匙。丢了找不回，也不要截图或发给别人。",
  "notice.note12": "这 12 个词就是账户的钥匙。丢了找不回，也不要截图或发给别人。",
  "notice.ack": "我知道丢了就没了",
  "notice.ackRequired": "请先确认你理解助记词无法代为恢复。",

  "mnemonic.title": "抄下助记词",
  "mnemonic.reveal": "点击显示",
  "mnemonic.copyRisky": "复制（容易泄露）",
  "mnemonic.copyHint": "复制会进剪贴板，用完请马上清掉。",
  "mnemonic.ackHand": "我已经手抄好了",
  "mnemonic.toVerify": "去核对",

  "verify.title": "点选核对",
  "verify.hint": "按提示点第 {list} 个词。点错了再点一下就能改。",
  "verify.slot": "第 {n} 个",
  "verify.wrong": "这几个词不对，点掉再重选。",
  "verify.complete": "完成",

  "import.title": "导入",
  "import.chooseMnemonic": "助记词",
  "import.chooseHex": "原始种子",
  "import.oneVaultNote": "一个安装只保留一份助记词或原始种子保管库。",
  "import.titleMnemonic": "导入助记词",
  "import.titleHex": "导入原始种子",
  "import.kindMnemonic": "助记词",
  "import.kindHex": "种子",
  "import.placeholderMnemonic": "词与词之间用空格",
  "import.placeholderHex": "偶数位的种子",
  "import.wordCount": "助记词一般是 12 或 24 个词。",
  "import.hexInvalid": "种子应是偶数位的十六进制。",

  "watch.title": "观察者钱包",
  "watch.sub": "只跟踪你粘贴的这一条地址。余额和支出是该地址净变动，不含同一种子下其他收款/找零地址；因此可能与桌面钱包总余额不一致。",
  "watch.addressLabel": "地址",
  "watch.placeholder": "prl1…",
  "watch.start": "开始查看",

  "done.title": "准备好了",
  "done.enter": "进入钱包",
  "done.created": "{name} 已建立。",

  "lock.title": "已锁定",
  "lock.placeholder": "请输入密码",
  "lock.passwordAria": "密码",
  "lock.unlock": "解锁",
  "lock.hint.vaultReadFailed": "已经有钱包，但这次没能读取。不会新建或覆盖。",
  "lock.hint.resumePassword": "请输入创建这个钱包时的原密码。刚才没保存上的新密码不能打开它。",

  "home.balanceLabel": "余额",
  "home.hideBalance": "隐藏余额",
  "home.showBalance": "显示余额",
  "home.lockNow": "马上锁定",
  "home.fiat.loading": "总价值查询中",
  "home.fiat.noQuote": "总价值暂无报价",
  "home.spotPrefix": "现价",
  "home.balance.loading": "查询中",
  "home.receive": "收款",
  "home.send": "发送",
  "home.recentActivity": "最近活动",
  "home.activityAll": "全部",
  "home.avail.loading": "可用余额查询中",
  "home.avail": "可用 {amount} PEARL",
  "home.avail.unavailable": "可用余额暂时查不到",
  "home.limit.watch": "只看这一条地址：余额与支出不含其他收款/找零地址，可能与桌面总余额不一致。只能查看，不能发送。",
  "home.limit.key": "私钥账户现在只能查看，不能发送。",

  "receive.title": "收款",
  "receive.addressLabel": "收款地址",
  "receive.copy": "复制地址",
  "receive.newAddressTitle": "快速新地址 — 本地缓存，不等链",
  "receive.newAddressAria": "用本地缓存快速生成新地址",
  "receive.newAddressScanTitle": "扫描链上未使用地址 — 较慢但更稳",
  "receive.newAddressScanAria": "扫描链上未使用地址",
  "receive.scanning": "正在扫描链上未使用地址…",
  "receive.scanExhausted": "这次扫描窗口内没有找到未使用的收款地址，请稍后再试。",
  "receive.tempHintLocal": "本地缓存临时地址 — 首页仍显示首次收款地址。",
  "receive.tempHintScan": "链上扫描得到的临时未使用地址 — 首页仍显示首次收款地址。",
  "receive.tempHintPick": "已选用的临时地址 — 首页仍显示首次收款地址。",
  "receive.pickAddressTitle": "选用已有收款地址",
  "receive.pickAddressAria": "选用已有收款地址",
  "receive.pickTitle": "选择地址",
  "receive.pickHint": "仅本次收款页临时使用 — 首页仍显示首次收款地址。",
  "toast.newReceiveAddrLocal": "已显示临时地址（本地）",
  "toast.newReceiveAddrScan": "已显示临时未使用地址",
  "toast.receivePicked": "已选用临时地址",
  "settings.receiveAddresses": "收款地址",
  "settings.accountStructure": "账户结构",
  "addresses.title": "收款地址",
  "addresses.sub": "当前账户已知的收款地址。首页始终用首次地址；其它可在此复制，或在收款页临时选用。",
  "addresses.empty": "暂无收款地址可显示。",
  "addresses.tag.default": "默认",
  "addresses.tag.used": "已用",
  "addresses.tag.change": "找零",
  "addresses.tag.index": "#{n}",
  "addresses.unlockRequired": "请先解锁钱包以列出派生收款地址。",
  "addresses.copyAria": "复制地址",
  "structure.title": "账户结构",
  "structure.sub": "只读查看当前账户的收款链与找零链。首页仍用首次收款地址。请勿把找零地址当作对外收款地址。",
  "structure.scan": "扫描链上已用地址",
  "structure.scanning": "正在扫描收款与找零链…",
  "structure.receiveHeading": "收款",
  "structure.changeHeading": "找零（内部）",
  "structure.changeHint": "找零地址用于发送后的剩余资金。请尽量不要当作对外收款地址。",
  "structure.receiveEmpty": "本地游标下还没有收款地址。",
  "structure.changeEmpty": "本地游标下还没有找零地址。",
  "structure.receiveIndex": "收款 #{n}",
  "structure.changeIndex": "找零 #{n}",
  "structure.unlockRequired": "请先解锁钱包以查看派生账户结构。",
  "structure.watchOnly": "观察者只跟踪单地址，没有 HD 收款/找零树。",

  "send.title": "发送",
  "send.progress12": "发送进度 1/2",
  "send.progress22": "发送进度 2/2",
  "send.toLabel": "收款地址",
  "send.toPlaceholder": "prl1…",
  "send.addressOk": "地址格式正确",
  "send.amountLabel": "金额",
  "send.amountAria": "金额",
  "send.amountPlaceholder": "0",
  "send.networkFee": "网络费",
  "send.fee.slow": "慢",
  "send.fee.standard": "标准",
  "send.fee.fast": "快",
  "send.fee.etaSlow": "约 25 块",
  "send.fee.etaStandard": "约 10 块",
  "send.fee.etaFast": "约 1 块",
  "send.customFee": "自定义费率",
  "send.customRateLabel": "每字节多少 grain",
  "send.customRatePlaceholder": "例如 8",
  "send.grainHint": "1 PEARL = 1 亿 grain。平时不用改这里。",

  "confirm.title": "核对",
  "confirm.recipient": "收款地址",
  "confirm.amount": "金额",
  "confirm.fee": "网络费",
  "confirm.total": "一共扣款",
  "confirm.changeDetails": "找零明细（一般可忽略）",
  "confirm.changeAddress": "找零地址",
  "confirm.changeAmount": "找零",
  "confirm.signSend": "签名并发送",

  "status.unknown": "状态未知",
  "status.pendingConfirm": "待确认",
  "status.viewTx": "查看交易",
  "status.backHome": "回到首页",
  "status.broadcasting": "正在广播",
  "status.notYetSent": "还没送出",
  "status.sent": "已发送",
  "status.failed": "失败",
  "status.confirmCount": "{n} 确认",

  "activity.title": "活动",
  "activity.detailTitle": "活动",
  "activity.status": "状态",
  "activity.time": "时间",
  "activity.txid": "交易号",
  "activity.time.unknown": "时间未知",
  "activity.time.pending": "未入块",
  "activity.title.in": "收入",
  "activity.title.out": "支出",
  "activity.title.zero": "净额为零",
  "activity.confirm.unconfirmed": "未确认",
  "activity.confirm.unknown": "状态未知",
  "activity.confirm.confirmed": "已确认",
  "activity.confirm.detailUnknown": "确认数未知",
  "activity.confirm.detailCount": "已确认 · {n} 确认",
  "activity.empty.title": "还没有活动",
  "activity.empty.failedTitle": "暂时看不到活动",
  "activity.empty.hint": "收款或发送后，记录会出现在这里。",
  "activity.empty.noRecords": "还没有记录",
  "activity.action.receive": "去收款",

  "settings.title": "设置",
  "settings.security": "安全",
  "settings.viewSeed": "查看助记词",
  "settings.changePassword": "修改密码",
  "settings.autoLock": "自动锁定",
  "settings.wallet": "钱包",
  "settings.accountName": "账户名称",
  "settings.network": "网络",
  "settings.preferences": "偏好设置",
  "settings.language": "语言",
  "settings.languageGroup": "语言",
  "settings.about": "关于",
  "settings.privacy": "隐私说明",
  "settings.supportPearla": "支持 Pearla",
  "settings.website": "官网",
  "settings.websiteAria": "官网，在新标签页打开 pearla.net",
  "settings.source": "开源地址",
  "settings.sourceAria": "开源地址，在新标签页打开 GitHub",
  "settings.removeVault": "删除当前钱包",
  "settings.removeTitle": "删除当前钱包",
  "settings.removeWarn": "这将从这台浏览器删除已加密的钱包，无法撤销。之后只能用助记词恢复。",
  "settings.removePassword": "密码",
  "settings.removeNeedPassword": "请输入密码以删除当前钱包。",
  "settings.removeAction": "确认删除",

  "lang.english": "English",
  "lang.chinese": "中文",

  "pwchange.title": "修改密码",
  "pwchange.current": "当前密码",
  "pwchange.new": "新密码",
  "pwchange.confirm": "再输入一次",
  "pwchange.confirmPlaceholder": "再写一遍",
  "pwchange.save": "保存新密码",
  "pwchange.newTooShort": "新密码至少 {min} 位。",
  "pwchange.mismatch": "两次新密码不一致。",
  "pwchange.sameAsCurrent": "新密码和当前密码一样。",
  "pwchange.fail": "没有改成。",

  "idle.title": "自动锁定",
  "idle.sub": "一段时间没操作就锁上。点选即可记住，下次打开后生效。",
  "idle.durationGroup": "锁定时长",
  "idle.min1": "1 分钟",
  "idle.min1Hint": "短时离开也锁",
  "idle.min5": "5 minutes",
  "idle.min5Hint": "默认时长",
  "idle.min15": "15 分钟",
  "idle.min15Hint": "稍长会话",
  "idle.customSection": "自定义",
  "idle.customTitle": "自定义时长",
  "idle.customMinutes": "自定义分钟数",
  "idle.customToggleEdit": "修改自定义时长",
  "idle.customToggleCollapse": "收起自定义表单",
  "idle.minutesLabel": "分钟数",
  "idle.minutesPlaceholder": "1–120",
  "idle.note": "当前是 {min} 分钟。改完后，下次打开钱包再生效。",
  "idle.value": "{min} 分钟",
  "idle.rangeError": "请输入 {min}–{max} 的整数分钟",

  "network.title": "网络",
  "network.sub": "点选即可切换。主网与测试网地址不同，自定义需填写索引后再保存。",
  "network.presetGroup": "固定网络",
  "network.customSection": "自定义",
  "network.customTitle": "自定义网络",
  "network.customTitleMainnet": "自定义 · 主网",
  "network.customTitleTestnet": "自定义 · 测试网",
  "network.addCustom": "添加自定义网络",
  "network.editCustom": "编辑自定义网络",
  "network.collapseCustom": "收起自定义表单",
  "network.addrNetworkLabel": "地址网络",
  "network.addrNetworkGroup": "自定义地址网络",
  "network.schemeLabel": "协议",
  "network.schemeGroup": "协议",
  "network.httpCleartext": "http 会明文发送地址和已签名交易，只允许 127.0.0.1 或 localhost。",
  "network.hostLabel": "主机",
  "network.hostPlaceholder": "例如 127.0.0.1",
  "network.portLabel": "端口",
  "network.portPlaceholder": "可留空",
  "network.saveSwitch": "保存并切换",

  "privacy.title": "隐私说明",
  "privacy.p1": "这是 Pearla（掌上明珠）。公开隐私政策：pearla.net/privacy。",
  "privacy.p2": "助记词、种子、私钥和密码只留在这台设备上，加密后存在本机。会话里只有解锁截止时间。",
  "privacy.p3": "地址查询、费率和你确认后的已签名交易只发往你在「网络」里选定的索引节点（默认 blockbook.pearlresearch.ai）。密码和助记词不在这些请求里。",
  "privacy.p4": "首页美元总价值优先查询 Coinbase PEARL-USD，失败时改用 CoinGecko；请求不含地址、余额明细或密钥。",
  "privacy.p5": "不读取浏览记录，也不向网页注入接口。",

  "donate.title": "支持 Pearla",
  "donate.blurb": "自愿捐赠，用于 Pearla 维护。只提供地址供你复制，不会自动转账，也不会打开发送页。",
  "donate.mainnetAddress": "主网收款地址",
  "donate.hint": "复制后请自行粘贴到发送页，并核对地址。",
  "donate.copy": "复制地址",
  "donate.noAddress": "暂无捐赠地址",

  "rename.title": "账户名称",
  "rename.current": "当前账户",
  "rename.save": "保存名称",

  "secret.title": "助记词",
  "secret.gateTitle": "再次确认本机密码",
  "secret.gateBody": "助记词只在本机显示，不会上传。",
  "secret.devicePassword": "本机密码",
  "secret.verifyContinue": "核对并继续",
  "secret.afterShowHint": "显示后不要截图，看完就返回。",
  "secret.warnTitle": "即将显示助记词",
  "secret.warnBody": "旁人勿看，也不要截图或拍照。",
  "secret.reveal": "点击显示助记词",
  "secret.clearedOnLeave": "离开本页后会清除显示。",

  "accounts.title": "账户",
  "accounts.add": "添加账户",
  "accounts.addContinue": "继续添加",
  "accounts.addWatch": "观察者钱包",
  "accounts.addHint": "「添加账户」在当前助记词下再派生一个，不会覆盖现有钱包。「观察者钱包」只看单地址，余额不含找零等其他地址。",
  "accounts.renameAria": "改名",
  "accounts.nameAria": "账户名称",
  "accounts.removeWatchAria": "移除观察地址",
  "accounts.removeWatchConfirmAria": "再点一次确认移除",

  "addAccount.title": "添加账户",
  "addAccount.warn": "上一个账户还没有链上记录。仍可新建，但若新账户一直没有收款或转账，只靠助记词在别处恢复时可能扫不到这个空账户；本机名单里仍会保留。",

  "unlock.title": "输入密码",
  "unlock.password": "密码",
  "unlock.placeholder": "密码",
  "unlock.signSend": "签名并发送",

  "accountPw.title": "输入密码",
  "accountPw.password": "密码",
  "accountPw.placeholder": "解锁密码",

  "account.default": "账户",
  "account.one": "账户 1",
  "account.number": "账户 {n}",
  "account.importedKey": "导入私钥",
  "account.watchAddress": "观察地址",
  "account.kind.watchPrefix": "观察 · ",
  "account.kind.keyPrefix": "私钥 · ",

  "time.notInBlock": "还没进块",
  "time.justNow": "刚刚",
  "time.minutesAgo": "{n} 分钟前",
  "time.hoursAgo": "{n} 小时前",
  "time.daysAgo": "{n} 天前",

  "fee.loadingNote": "正在查询网络费率…",
  "fee.querying": "查询中",
  "fee.estimate": "≈ {amount} PEARL",
  "fee.rate": "{rate} grain/vB",
  "fee.selected": "{rate} grain/vB · ≈ {amount} PEARL",
  "fee.note.live": "费率来自当前网络。上方金额为预估，实际以核对页为准。",
  "fee.note.fallback": "暂时无法获取网络费率，已显示备用值。实际以核对页为准。",
  "fee.note.tied": "当前网络较空闲，标准与慢的费率相同。",

  "send.amtDecimals": "金额最多 8 位小数。",
  "send.insufficient": "余额不够。",
  "send.enterAmountOrMax": "请输入金额，或点「全部」。",
  "send.preparing": "正在准备…",
  "send.customRateRange": "请填 1 到 10000 的整数。",
  "send.balanceLoading": "余额还在查询，稍后再试",
  "send.watchNoSend": "观察地址不能签名或发送。",
  "send.keyNoSend": "独立私钥账户暂不能发送。请使用助记词派生账户。",
  "send.keyNoSendDetail": "独立私钥的找零路径尚未按官方导入规则核实，已禁止发送。请使用助记词派生账户。",
  "send.unlockFirst": "请先解锁后再发送",
  "send.noDraft": "没有可发送的草稿",
  "send.noUtxo": "没有已确认且成熟的可用 UTXO",
  "send.balanceNoUtxo": "看得到余额，但还没有已确认可花费的 UTXO（找零可能仍在同步）。请稍后再试。",
  "send.utxoCap": "可用 UTXO 超过本阶段的 100 项上限，请先分别整理后再发送",
  "send.selfPay": "收款地址是本账户正在花费的地址，请换成其他地址（不要发给当前这笔要花掉的余额所在地址）",
  "send.noChangeAddr": "找不到可用的找零地址，请稍后再试",
  "send.draftFail": "没有准备好草稿。",

  "addr.mixedCase": "大小写不要混着用。",
  "addr.checksum": "这串地址对不上，请整段粘贴。",
  "addr.badChars": "里面有不能用的字符。",
  "addr.wrongNetworkTestnet": "这不是测试网地址。",
  "addr.wrongNetworkMainnet": "这不是主网地址。",
  "addr.enterFirst": "先填收款地址。",
  "addr.invalid": "这个地址看起来不对。",

  "home.status.noAddress": "还没有可用地址，请稍后重试。",
  "home.status.networkUnlock": "网络已切换，请先解锁以刷新地址。",
  "home.status.queryFailNotZero": "{message}。没有当成 0。",
  "home.noAddressList": "还没有可用地址。",

  "toast.copied": "已复制",
  "toast.copiedClipboardClear": "已复制。约 30 秒后会尝试清掉剪贴板",
  "toast.addressCopied": "地址已复制",
  "toast.txidCopied": "交易号已复制",
  "toast.donateCopied": "捐赠地址已复制",
  "toast.copyFailManual": "复制失败，请长按地址手动复制",
  "toast.nameSaved": "名称已保存",
  "toast.renamed": "已重命名",
  "toast.accountAdded": "已添加账户",
  "toast.watchRemoved": "已移除观察地址",
  "toast.removeWatchConfirm": "再点一次以移除该观察地址",
  "toast.removeFailed": "没有移除成功",
  "toast.addFailed": "没有加上。",
  "toast.passwordWrong": "密码不正确，请重新输入",
  "toast.idleSaved": "已记住，下次打开后生效",
  "toast.networkSwitchLocked": "网络已切换，解锁后会按新网络显示地址",
  "toast.networkRederived": "已切换网络，地址已按新网络重新派生",
  "toast.networkCustomSaved": "已保存并切换到自定义网络",
  "toast.networkSwitched": "已切换到所选网络",
  "toast.refreshFailBalance": "刷新失败，仍显示上次余额",
  "toast.activityRefreshFail": "活动刷新失败，仍显示上次记录",
  "toast.networkMismatch": "当前地址与所选网络不符，请解锁后刷新",
  "toast.newReceiveAddr": "已显示临时收款地址",
  "toast.watchNoSend": "观察地址不能签名或发送。",
  "toast.keyNoSend": "独立私钥账户暂不能发送。请使用助记词派生账户。",
  "toast.removeVaultConfirm": "再次点击“删除当前钱包”确认删除。",
  "toast.vaultRemoved": "当前钱包已删除。",
  "toast.passwordUpdated": "密码已更新",
  "toast.donateNotConfigured": "捐赠地址尚未配置",
  "toast.openLinkManual": "请手动打开链接",
  "toast.openSiteManual": "请手动打开官网",
  "toast.openSourceManual": "请手动打开开源地址",
  "toast.sendFailed": "没有发出去。",
  "toast.qrFail": "二维码生成失败，请复制地址。",

  "qr.fail": "二维码生成失败，请复制地址。",

  "net.failSwitch": "没有切换成功",
  "net.failSave": "没有保存成功",
  "net.cannotSavePrefs": "无法保存网络设置",

  "import.unsupportedKey": "暂不支持导入私钥。请用助记词或原始种子，或用「观察者钱包」查看外部地址。",
  "import.vaultExists": "一个安装只保留一个助记词保管库。请用「添加账户」扩展同一种子，或先删除当前钱包。",

  "seed.notMnemonic": "这个保管库不是助记词。",
  "seed.openFail": "暂时打不开。",

  "unlock.required": "请先解锁",
  "unlock.addNeedsPassword": "请先输入当前保管库密码，再添加账户。",

  "home.balance.unknown": "未知",
  "mnemonic.handCopyRequired": "请先显示并确认已手抄。",
  "receive.openFail": "没有打开收款页。",

  "external.manualLink": "请手动打开链接",

  "error.queryFailed": "查询失败",
  "error.queryAborted": "查询已取消",
};

Object.assign(zh, errorCatalogZh);

zh["idle.min5"] = "5 分钟";

const catalogs = { en, zh };

export { catalogs };

export function normalizeLocale(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "zh" || raw.startsWith("zh-")) return "zh";
  return "en";
}

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale) {
  currentLocale = normalizeLocale(locale);
}

function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const val = vars[name];
    return val === undefined || val === null ? `{${name}}` : String(val);
  });
}

function messageFor(locale, key) {
  const primary = catalogs[locale]?.[key];
  if (primary != null) return primary;
  const fallback = catalogs.en[key];
  if (fallback != null) return fallback;
  return key;
}

export function t(key, vars, locale = currentLocale) {
  return interpolate(messageFor(normalizeLocale(locale), key), vars);
}

export function packMessage(key, vars) {
  if (vars && Object.keys(vars).length) return `${I18N_PREFIX}${key}:${JSON.stringify(vars)}`;
  return `${I18N_PREFIX}${key}`;
}

export function unpackMessage(message) {
  if (typeof message !== "string" || !message.startsWith(I18N_PREFIX)) return null;
  const body = message.slice(I18N_PREFIX.length);
  const colon = body.indexOf(":");
  if (colon === -1) return { key: body, vars: undefined };
  const key = body.slice(0, colon);
  try {
    const vars = JSON.parse(body.slice(colon + 1));
    if (vars && typeof vars === "object" && !Array.isArray(vars)) return { key, vars };
  } catch { /* fall through */ }
  return { key: body, vars: undefined };
}

export function err(key, vars) {
  const error = new Error(packMessage(key, vars));
  error.name = "AppError";
  error.key = key;
  if (vars) error.vars = vars;
  return error;
}

export function speak(value, locale = currentLocale) {
  if (value == null) return "";
  const lang = normalizeLocale(locale);
  if (typeof value === "object" && value.key) {
    return t(value.key, value.vars, lang);
  }
  const raw = typeof value === "object" && value.message != null ? value.message : String(value);
  const unpacked = unpackMessage(raw);
  if (unpacked) return t(unpacked.key, unpacked.vars, lang);
  if (catalogs.en[raw]) return t(raw, undefined, lang);
  return raw;
}

const I18N_ATTRS = [
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-aria-label", "aria-label"],
  ["data-i18n-alt", "alt"],
  ["data-i18n-title", "title"],
];

export function applyDom(root) {
  const scope = root || (typeof document !== "undefined" ? document : null);
  if (!scope) return;
  const locale = getLocale();
  const doc = scope.nodeType === 9 ? scope : scope.ownerDocument;
  if (doc?.documentElement) doc.documentElement.lang = locale === "zh" ? "zh-CN" : "en";

  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    el.textContent = t(key);
  });

  for (const [attr, prop] of I18N_ATTRS) {
    scope.querySelectorAll(`[${attr}]`).forEach((el) => {
      const key = el.getAttribute(attr);
      if (!key) return;
      el.setAttribute(prop, t(key));
    });
  }
}