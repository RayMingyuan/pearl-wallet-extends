/** One-off generator for src/i18n-errors.js — run after editing pairs below. */
import { writeFileSync } from "node:fs";

/** @type {Record<string, [string, string]>} key -> [zh, en] */
const pairs = {
  // vault
  "err.vault.passwordWrongInput": ["密码不正确，请重新输入", "Wrong password — try again"],
  "err.vault.passwordUniformShort": ["不足 12 位时，不能只用字母、数字，或靠空格凑长度", "Under 12 characters, a password cannot be only letters or only numbers, or padded with spaces"],
  "err.vault.cancelledReunlock": ["操作已因锁定取消，请重新解锁", "Operation cancelled by lock — unlock again"],
  "err.vault.unlockRequired": ["请先解锁保管库", "Unlock the vault first"],
  "err.vault.changedElsewhere": ["保管库已在其他页面改变，请重新打开", "Vault changed elsewhere — reopen"],
  "err.vault.cancelledRetry": ["操作已因锁定取消，请重试", "Operation cancelled by lock — try again"],
  "err.vault.wrongPasswordNotWritten": ["密码错误或保管库已损坏，未写入", "Wrong password or vault damaged — not saved"],
  "err.vault.wrongPassword": ["密码错误或保管库已损坏，未解锁", "Wrong password or vault damaged — not unlocked"],
  "err.vault.notReady": ["保管库尚未完成读取", "Vault is not ready yet"],
  "err.vault.busy": ["保管库正在处理，请稍后重试", "Vault is busy — try again shortly"],
  "err.vault.noWebLocksModify": ["浏览器缺少 Web Locks，未修改保管库", "Browser lacks Web Locks — vault not modified"],
  "err.vault.existsUnlockFirst": ["已有保管库，请先解锁；不会覆盖", "A vault already exists — unlock first; it will not be overwritten"],
  "err.vault.alreadyUnlocked": ["保管库已经解锁", "Vault is already unlocked"],
  "err.vault.directoryInvalid": ["保管库目录结构无效", "Vault directory structure is invalid"],
  "err.vault.missingHdMaterial": ["保管库缺少助记词或种子", "Vault is missing mnemonic or seed"],
  "err.vault.unlockBeforeImportKey": ["请先解锁后再导入私钥", "Unlock before importing a private key"],
  "err.vault.importKeyDuplicateAddress": ["这个私钥对应的地址已经在账户里", "This private key’s address is already in the account list"],
  "err.vault.accountAddressMismatch": ["账户地址与种子不一致，未写入", "Account address does not match seed — not saved"],
  "err.vault.unlockBeforeChangePassword": ["请先解锁后再修改密码", "Unlock before changing password"],
  "err.vault.unlockConfirmDraft": ["请先解锁保管库并确认交易草稿", "Unlock the vault and confirm the transaction draft"],
  "err.vault.txNetworkSessionMismatch": ["交易网络与保管库会话不符", "Transaction network does not match vault session"],
  "err.vault.txPathNotInVault": ["来源或找零地址不属于所选保管库路径", "Source or change address is not on the selected vault path"],
  "err.vault.unlockBeforeDelete": ["请先解锁后再删除", "Unlock before deleting"],
  "err.vault.unknownOperation": ["未知保管库操作", "Unknown vault operation"],
  "err.vault.unavailable": ["保管库不可用", "Vault is unavailable"],
  "err.vault.operationFailed": ["保管库操作失败", "Vault operation failed"],
  "err.vault.ciphertextFormatInvalid": ["加密保管库格式无效", "Encrypted vault format is invalid"],
  "err.vault.unsupportedOrCorrupt": ["不支持或损坏的加密保管库", "Unsupported or corrupted encrypted vault"],

  // activity
  "err.activity.txIoMissing": ["交易输入或输出缺失", "Transaction inputs or outputs are missing"],
  "err.activity.txidInvalid": ["交易号无效", "Transaction ID is invalid"],
  "err.activity.confirmationsInvalid": ["确认数无效", "Confirmation count is invalid"],
  "err.activity.blockTimeInvalid": ["区块时间无效", "Block time is invalid"],
  "err.activity.dataMissing": ["活动数据缺失", "Activity data is missing"],
  "err.activity.spendHintInvalid": ["发送金额提示无效", "Send amount hint is invalid"],
  "err.activity.groupsMissing": ["活动分组数据缺失", "Activity group data is missing"],
  "err.activity.mergeFailed": ["活动记录无法聚合", "Activity records could not be merged"],
  "err.activity.parseFailed": ["活动记录无法解析", "Activity records could not be parsed"],

  // amount
  "err.amount.notInteger": ["{field} 不是十进制整数字符串", "{field} is not a decimal integer string"],
  "err.amount.decimalsInvalid": ["小数位数无效", "Decimal places are invalid"],
  "err.amount.mustBeIntegerGrain": ["金额必须是整数 grain", "Amount must be an integer grain value"],

  // qr
  "err.qr.missingToCanvas": ["缺少 qrcode.toCanvas", "qrcode.toCanvas is missing"],

  // pearl price extras
  "err.price.balanceMustBeNonNegGrain": ["余额必须是非负 grain", "Balance must be a non-negative grain value"],
  "err.price.noUsdQuote": ["暂无 PEARL 美元报价", "No PEARL USD quote available"],

  // keys
  "err.keys.seedFormatInvalid": ["种子格式无效", "Seed format is invalid"],
  "err.keys.mnemonicInvalid": ["助记词词数、单词或校验和不正确", "Mnemonic word count, words, or checksum is incorrect"],
  "err.keys.hexSeedInvalid": ["原始种子须为 16–64 字节十六进制", "Raw seed must be 16–64 bytes of hex"],
  "err.keys.seedUnsupported": ["不支持的种子格式", "Unsupported seed format"],
  "err.keys.deriveIndexInvalid": ["派生索引无效", "Derivation index is invalid"],
  "err.keys.needLocalDerivation": ["需要本地私有派生节点", "Local private derivation is required"],
  "err.keys.childKeyInvalid": ["派生子键无效", "Derived child key is invalid"],
  "err.keys.accountIndexInvalid": ["账户序号无效", "Account index is invalid"],
  "err.keys.pathBranchInvalid": ["只支持收款/找零分支及有效索引", "Only receive/change branches and valid indices are supported"],
  "err.keys.taprootOutputInvalid": ["Taproot 输出键无效", "Taproot output key is invalid"],
  "err.keys.privateKeyHexInvalid": [
    "私钥须为 32 字节十六进制。WIF 与其他编码尚未按官方导入入口核实，不能在这里使用。",
    "Private key must be 32 bytes of hex. WIF and other encodings are not verified for official import and cannot be used here.",
  ],
  "err.keys.privateKeyScalarInvalid": ["私钥不在曲线阶内", "Private key is not in the curve order"],
  "err.keys.taprootTweakInvalid": ["Taproot tweak 无效", "Taproot tweak is invalid"],
  "err.keys.taprootPrivateInvalid": ["Taproot 私钥无效", "Taproot private key is invalid"],

  // address
  "err.addr.witnessVersionUnsupported": ["不支持的见证版本", "Unsupported witness version"],
  "err.addr.witnessProgramLength": ["见证程序长度无效", "Witness program length is invalid"],
  "err.addr.witnessProgramEncode": ["见证程序无法编码", "Witness program cannot be encoded"],
  "err.addr.invalidBech32m": ["地址无效。仅接受 Pearl 主网 bech32m 公开地址（Taproot 或 P2MR）。", "Invalid address. Only Pearl mainnet bech32m public addresses (Taproot or P2MR) are accepted."],
  "err.addr.mixedCase": ["地址无效。字母大小写不能混用。", "Invalid address. Do not mix upper and lower case."],
  "err.addr.badChars": ["地址无效。含有 bech32 不接受的字符。", "Invalid address. Contains characters bech32 cannot encode."],
  "err.addr.checksum": ["地址校验失败。请粘贴完整公开地址，不要手打。", "Address checksum failed. Paste the full public address; do not type it by hand."],
  "err.addr.enterFirst": ["请输入你自己的 PEARL 公开地址。", "Enter your PEARL public address."],
  "err.addr.hrpMismatch": ["地址与所选网络不符（HRP 须为 {hrp}）。", "Address does not match the selected network (HRP must be {hrp})."],
  "err.addr.missingWitnessVersion": ["地址无效。缺少见证版本。", "Invalid address. Missing witness version."],
  "err.addr.witnessVersionRejected": ["仅支持 Taproot（见证版本 1）或 P2MR（见证版本 2）公开地址。", "Only Taproot (witness v1) or P2MR (witness v2) public addresses are supported."],
  "err.addr.programNot32Bytes": ["地址无效。见证程序必须是 32 字节。", "Invalid address. Witness program must be 32 bytes."],

  // transaction
  "err.tx.hexInvalid": ["交易 hex 无效或过大", "Transaction hex is invalid or too large"],
  "err.tx.integerOutOfRange": ["交易整数超出范围", "Transaction integer is out of range"],
  "err.tx.amountFormat": ["金额须为最多 8 位小数的 PEARL 数字", "Amount must be a PEARL number with at most 8 decimal places"],
  "err.tx.amountTooLarge": ["金额超过主网最大范围", "Amount exceeds mainnet maximum"],
  "err.tx.taprootOnly": ["仅支持所选 Pearl 网络的 Taproot 地址，拒绝 P2MR 及其他格式", "Only Taproot addresses on the selected Pearl network are supported; P2MR and other formats are rejected"],
  "err.tx.prevTxTruncated": ["前序交易被截断", "Previous transaction is truncated"],
  "err.tx.prevTxLengthInvalid": ["前序交易长度编码无效", "Previous transaction length encoding is invalid"],
  "err.tx.witnessMarkerUnsupported": ["不支持的 witness 标记", "Unsupported witness marker"],
  "err.tx.prevInputCountInvalid": ["前序交易输入数无效", "Previous transaction input count is invalid"],
  "err.tx.prevOutputCountInvalid": ["前序交易输出数无效", "Previous transaction output count is invalid"],
  "err.tx.prevOutputValueInvalid": ["前序输出金额无效", "Previous output value is invalid"],
  "err.tx.witnessItemsTooMany": ["witness 项过多", "Too many witness items"],
  "err.tx.emptyWitnessInvalid": ["空 witness 编码无效", "Empty witness encoding is invalid"],
  "err.tx.prevTxTrailingData": ["前序交易存在多余数据", "Previous transaction has trailing data"],
  "err.tx.utxoListInvalid": ["UTXO 列表无效，最多处理 100 项", "UTXO list is invalid; at most 100 items"],
  "err.tx.utxoFieldInvalid": ["UTXO 字段无效", "UTXO field is invalid"],
  "err.tx.utxoMissingAddress": ["UTXO 缺少地址", "UTXO is missing an address"],
  "err.tx.utxoDuplicate": ["UTXO 重复，已拒绝构建", "Duplicate UTXO — build rejected"],
  "err.tx.prevTxDataCap": ["前序交易数据总量超过本阶段的 4 MB 上限", "Previous transaction data exceeds the 4 MB cap for this stage"],
  "err.tx.utxoPrevMismatch": ["前序交易与 UTXO 金额、地址或 txid 不一致", "Previous transaction does not match UTXO value, address, or txid"],
  "err.tx.pathInvalid": ["地址派生路径无效", "Address derivation path is invalid"],
  "err.tx.destSameAsChange": ["收款地址不能与找零地址相同", "Destination cannot be the same as change address"],
  "err.tx.feeRateRange": ["费率须为 1–10000 整数 grain/vB", "Fee rate must be an integer from 1–10000 grain/vB"],
  "err.tx.feeCapZero": ["最高总手续费须大于 0", "Maximum total fee must be greater than 0"],
  "err.tx.belowDust": ["收款金额低于 333 grain 尘埃阈值", "Payment is below the 333 grain dust threshold"],
  "err.tx.selfPayment": ["收款地址是本账户正在花费的地址，请换一个外部地址", "Destination is an address this account is spending; use an external address"],
  "err.tx.changeStillFunded": ["找零地址仍有未花余额，请换一个找零地址", "Change address still has unspent balance — use a different change address"],
  "err.tx.noMatureUtxo": ["没有已确认且成熟的可用 UTXO", "No confirmed, mature UTXOs available"],
  "err.tx.inputTotalOverflow": ["输入总额超出主网范围", "Input total exceeds mainnet range"],
  "err.tx.insufficientFunds": ["余额不足以支付金额与手续费", "Insufficient balance for amount and fee"],
  "err.tx.feeAboveCap": ["手续费超过你设置的最高总手续费", "Fee exceeds your maximum total fee"],
  "err.tx.signatureCount": ["签名数不一致", "Signature count does not match"],
  "err.tx.psbtScriptMismatch": ["PSBT 与描述符脚本不一致", "PSBT does not match descriptor script"],
  "err.tx.localSigVerifyFailed": ["本地签名校验失败", "Local signature verification failed"],
  "err.tx.vsizeFeeCheckFailed": ["交易尺寸或手续费校验失败", "Transaction size or fee check failed"],
  "err.tx.draftStale": ["交易草稿已变化，请重新构建并确认", "Transaction draft changed — rebuild and confirm"],
  "err.tx.sigTypeUnsupported": ["仅支持每输入一个 DEFAULT 签名的交易", "Only transactions with one DEFAULT signature per input are supported"],
  "err.tx.signedDraftMismatch": ["签名交易与已确认草稿不一致", "Signed transaction does not match confirmed draft"],
  "err.tx.txidInvalid": ["交易 ID 无效", "Transaction ID is invalid"],

  // psbt
  "err.psbt.hexInvalid": ["PSBT 十六进制无效", "PSBT hex is invalid"],
  "err.psbt.fieldTooLong": ["PSBT 字段过长", "PSBT field is too long"],
  "err.psbt.amountInvalid": ["PSBT 金额无效", "PSBT amount is invalid"],
  "err.psbt.draftInvalid": ["PSBT 草稿无效", "PSBT draft is invalid"],
  "err.psbt.truncated": ["PSBT 被截断", "PSBT is truncated"],
  "err.psbt.lengthInvalid": ["PSBT 长度编码无效", "PSBT length encoding is invalid"],
  "err.psbt.magicInvalid": ["PSBT 魔数无效", "PSBT magic is invalid"],
  "err.psbt.missingUnsignedTx": ["PSBT 缺少未签名交易", "PSBT is missing unsigned transaction"],
  "err.psbt.missingWitnessUtxo": ["PSBT 输入缺少 witness UTXO", "PSBT input is missing witness UTXO"],
  "err.psbt.witnessUtxoExtra": ["PSBT witness UTXO 有多余数据", "PSBT witness UTXO has extra data"],
  "err.psbt.noInputs": ["PSBT 没有输入", "PSBT has no inputs"],
  "err.psbt.draftMismatch": ["PSBT 与交易草稿不一致", "PSBT does not match transaction draft"],

  // blockbook
  "err.blockbook.utxoHttp": ["UTXO 查询返回 HTTP {status}", "UTXO query returned HTTP {status}"],
  "err.blockbook.payloadTooLarge": ["索引返回的交易数据过大", "Indexer returned transaction data that is too large"],
  "err.blockbook.utxoJsonInvalid": ["UTXO 查询返回的 JSON 无效", "UTXO query returned invalid JSON"],
  "err.blockbook.utxoListInvalid": ["UTXO 返回异常或超过本阶段的 100 项上限", "UTXO response is abnormal or exceeds the 100-item cap"],
  "err.blockbook.utxoAborted": ["UTXO 查询已取消", "UTXO query was cancelled"],
  "err.blockbook.utxoIdInvalid": ["索引返回的 UTXO 标识无效", "Indexer returned an invalid UTXO identifier"],
  "err.blockbook.prevTxMismatch": ["索引未返回匹配的原始交易", "Indexer did not return a matching raw transaction"],
  "err.blockbook.txHexInvalid": ["交易 hex 无效或过大", "Transaction hex is invalid or too large"],
  "err.blockbook.feeRateNotDecimal": ["费率不是十进制字符串", "Fee rate is not a decimal string"],
  "err.blockbook.feeRateOutOfRange": ["换算后的费率超出 1–10000 grain/vB", "Converted fee rate is outside 1–10000 grain/vB"],
  "err.blockbook.feeHttp": ["http", "HTTP error fetching fee rates"],

  // network / endpoints
  "err.network.unsupported": ["不支持的 Pearl 网络", "Unsupported Pearl network"],
  "err.network.invalid": ["网络无效", "Network is invalid"],
  "err.network.hostnameInvalid": ["主机名无效", "Hostname is invalid"],
  "err.network.portInvalid": ["端口无效", "Port is invalid"],
  "err.network.httpOnlyLoopback": ["http 只允许 127.0.0.1 或 localhost，公网索引请用 https", "http is only allowed for 127.0.0.1 or localhost; use https for a public indexer"],
  "err.network.indexerOriginInvalid": ["索引节点地址无效", "Indexer address is invalid"],
  "err.network.customHostRequired": ["请填写自定义索引主机", "Enter a custom indexer host"],
  "err.network.noIndexers": ["没有索引节点", "No indexers configured"],
  "err.network.indexerNotFound": ["没有这个索引节点", "That indexer does not exist"],
  "err.network.cannotSavePrefs": ["无法保存网络设置", "Cannot save network settings"],

  // storage
  "err.storage.addressMismatch": ["本地钱包地址记录不一致，请重新解锁并选择地址", "Local wallet address record is inconsistent — unlock and reselect the address"],
  "err.storage.notPubkeyString": ["本地记录不是公开地址字符串", "Local record is not a public address string"],
  "err.storage.recordAbnormal": ["本地记录异常", "Local record is abnormal"],
  "err.storage.walletListCorrupt": ["本机钱包列表损坏，请先导出备份再重建", "Local wallet list is corrupt — export a backup and rebuild"],
  "err.storage.chromeLocalUnavailable": ["chrome.storage.local 不可用", "chrome.storage.local is unavailable"],
  "err.storage.walletStateCorrupt": ["本机钱包状态损坏，请先导出备份再重建", "Local wallet state is corrupt — export a backup and rebuild"],
  "err.storage.addressNotLocalWallet": ["当前地址不是本地钱包地址，无法添加新钱包", "Current address is not a local wallet address — cannot add a wallet"],
  "err.storage.walletIdInvalid": ["钱包标识无效", "Wallet ID is invalid"],
  "err.storage.walletNotFound": ["未找到该本地钱包", "Local wallet not found"],
  "err.storage.noResponse": ["本地存储没有响应", "Local storage did not respond"],

  // broadcast
  "err.broadcast.recordCorrupt": ["广播记录损坏，已阻止重新发送", "Broadcast record is corrupt — resend blocked"],
  "err.broadcast.needSerialLock": ["广播必须提供串行锁", "Broadcaster requires a serial lock"],
  "err.broadcast.unsupportedChain": ["广播仅支持本地 regtest/simnet", "Broadcast only supports local regtest/simnet"],
  "err.broadcast.unsupportedMainnet": ["广播仅支持 Pearl 主网", "Broadcast only supports Pearl mainnet"],
  "err.broadcast.unsupportedMainnetTestnet": ["广播仅支持 Pearl 主网或测试网", "Broadcast only supports Pearl mainnet or testnet"],
  "err.broadcast.draftNetworkMismatch": ["草稿网络与广播网络不符", "Draft network does not match broadcast network"],
  "err.broadcast.confirmTxid": ["请核对网络、收款、金额、费用和找零，并明确确认本笔交易 ID", "Verify network, recipient, amount, fee, and change, and confirm this transaction ID"],
  "err.broadcast.journalCorrupt": ["广播日志损坏，不能重新发送", "Broadcast journal is corrupt — cannot resend"],
  "err.broadcast.journalStorageUnavailable": ["广播日志存储不可用", "Broadcast journal storage is unavailable"],
  "err.broadcast.networkInvalid": ["广播网络无效", "Broadcast network is invalid"],
  "err.broadcast.journalKeyInvalid": ["广播日志键无效", "Broadcast journal key is invalid"],

  // mainnet storage
  "err.mainnet.journalCorrupt": ["主网广播日志损坏，不能重新发送", "Mainnet broadcast journal is corrupt — cannot resend"],
  "err.mainnet.journalKeyInvalid": ["主网广播日志键无效", "Mainnet broadcast journal key is invalid"],
  "err.mainnet.addressInvalid": ["主网地址无效：{detail}", "Mainnet address invalid: {detail}"],
  "err.mainnet.txidInvalid": ["主网交易 ID 无效", "Mainnet transaction ID is invalid"],
  "err.mainnet.spendHintInvalid": ["主网发送金额提示无效", "Mainnet send amount hint is invalid"],
  "err.mainnet.journalStorageUnavailable": ["主网广播日志存储不可用", "Mainnet broadcast journal storage is unavailable"],

  // pearl price
  "err.price.pearlQuoteInvalid": ["PEARL 报价无效", "PEARL quote is invalid"],
  "err.price.notJson": ["报价不是 JSON", "Quote response is not JSON"],
  "err.price.coinbaseHttp": ["Coinbase 报价 HTTP {status}", "Coinbase quote HTTP {status}"],
  "err.price.coinbaseNotUsd": ["Coinbase 报价币种不是 USD", "Coinbase quote is not USD"],
  "err.price.coinbaseExchangeHttp": ["Coinbase Exchange 报价 HTTP {status}", "Coinbase Exchange quote HTTP {status}"],
  "err.price.coingeckoHttp": ["CoinGecko 报价 HTTP {status}", "CoinGecko quote HTTP {status}"],
  "err.price.coingeckoInvalid": ["CoinGecko 报价无效", "CoinGecko quote is invalid"],

  // popup / runtime
  "err.popup.permissionsUnavailable": ["当前环境无法申请索引节点权限", "Cannot request indexer permissions in this environment"],
  "err.popup.indexerNotGranted": ["未授权访问该索引节点，无法切换", "Indexer access not granted — cannot switch"],
  "err.popup.noWebLocksSend": ["浏览器缺少 Web Locks，无法安全发送", "Browser lacks Web Locks — cannot send safely"],

  // provider
  "err.provider.disabled": ["网页接口默认关闭", "Web provider is disabled by default"],
  "err.provider.needUserGesture": ["需要用户点击后才能连接", "A user click is required before connecting"],
  "err.provider.noBroadcast": ["默认不广播", "Broadcast is off by default"],
  "err.provider.missingPsbt": ["缺少 PSBT", "PSBT is missing"],
  "err.provider.unsupported": ["不支持的网页接口", "Unsupported web provider method"],

  // spend guard
  "err.spend.lockIdInvalid": ["花费锁定标识无效", "Spend lock ID is invalid"],
  "err.spend.pendingConflict": ["这笔输入还在等待上链结果，不能另组冲突交易。请先查证状态。", "This input is still pending — cannot build a conflicting transaction. Check status first."],

  // descriptor
  "err.descriptor.unencodable": ["描述符里有不能编码的字符", "Descriptor contains a character that cannot be encoded"],

  // internal (shell dev)
  "err.internal.missingDomNode": ["缺少界面节点 {id}", "Missing UI node {id}"],
};

const en = {};
const zh = {};
for (const [key, [z, e]] of Object.entries(pairs)) {
  en[key] = e;
  zh[key] = z;
}

const body = `// Auto-generated by scripts/generate-i18n-errors.mjs — edit pairs there and re-run.

export const errorCatalogEn = ${JSON.stringify(en, null, 2)};

export const errorCatalogZh = ${JSON.stringify(zh, null, 2)};

export const ERROR_KEY_COUNT = ${Object.keys(pairs).length};
`;

writeFileSync(new URL("../src/i18n-errors.js", import.meta.url), body);
console.log("Wrote src/i18n-errors.js with", Object.keys(pairs).length, "keys");