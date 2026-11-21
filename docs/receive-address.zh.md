# 收款地址交互（插件）

[English](receive-address.md)

本文记录 Pearla **有意区别于**官方 Pearl 桌面 HD 钱包的设计。

## 结论

| 位置 | 行为 |
|------|------|
| 首页地址条、首页复制、账户抽屉 | **永远**是该账户首次收款地址（收款链 `branch 0 / index 0`） |
| 打开「收款」 | 仍显示这个首次地址 |
| 收款页工具图标 | **闪电**：本地快速临时地址；**雷达**：链上扫描；**列表**：选用已有地址（均临时） |
| 设置 → 收款地址 | 管理页列出本账户已知收款地址，可复制 |
| 设置 → 账户结构 | 只读查阅当前账户收款链 + 找零链；可选扫描已用（有 loading） |
| 离开收款再进入 | 回到首次地址；临时地址**不会**变成新的默认 |

临时地址仍属于同一 HD 账户。为扫到其上的余额，持久化的 `receiveIndex` 游标可以前进；**界面默认身份**不跟随临时地址。

## 为何不借鉴桌面「每次进收款都换址」

官方桌面常在每次收款操作时轮换地址（隐私 / HD 习惯）。

Pearla 对公开 Blockbook 索引是**按地址**请求的。若每次打开收款都自动换址，`0…receiveIndex` 覆盖面会膨胀，首页刷新总余额会变慢。因此插件选择：

1. 日常使用 **固定默认**（首次收款地址）；
2. 需要时由用户在收款页用图标 **手动、临时** 换新 / 选用地址（本地、扫描或已有列表）；
3. **不把**临时地址提升为首页/默认身份；收款列表在「收款地址」，含找零的结构查阅在「账户结构」。

## 实现要点

- 默认展示：`vault.address(0, 0, account)`（账面 `item.address` 亦为 `0/0` 身份地址）。
- 临时展示：收款页会话内的 `tempReceiveIndex`；再次打开收款或锁定保管库时清空。
- 收款页图标：金色闪电 `#newRecv`（本地）；灰色雷达 `#newRecvScan`（链上扫描 + loading）；灰色列表 `#pickRecv`（选用已有，抽屉）。
- 设置「收款地址」`#screen-addresses`：列出 `0…receiveIndex` 与本地已用缓存中的收款地址，支持复制。
- 设置「账户结构」`#screen-structure`：只读列出收款 `0/i` 与找零 `1/j`（本地水位）；「扫描链上已用地址」才跑 gap（带 loading）。找零标明内部用途，不鼓励对外收款。
- 列表数据优先本地（水位 + `meta.usedReceive`），不为打开页面而全量打 index。
- 临时提示文案区分来源（本地 / 扫描 / 选用）；都不改首页默认。
- 观察者账户不显示换址图标；结构页说明无 HD 树，可显示其单地址。

## 相关代码

- `src/shell.js` — `listKnownReceiveAddresses`、`listAccountStructure`、`openAddressManager`、`openAccountStructure`、`openReceivePicker`
- `src/popup.html` — `#newRecv`、`#newRecvScan`、`#pickRecv`、`#recvPickSheet`、`#screen-addresses`、`#screen-structure`
- `src/vault-directory.js` — 账户 `address` 保持 `0/0` 作为身份
