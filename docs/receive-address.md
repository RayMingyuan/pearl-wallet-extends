# Receive address UX (extension)

[中文](receive-address.zh.md)

This document records an **intentional** difference from the official Pearl desktop HD wallet.

## Decision

| Surface | Behavior |
|---------|----------|
| Home chip, home copy, account sheet | **Always** the account’s first receive address (`branch 0 / index 0`) |
| Opening **Receive** | Shows that same first address again |
| Receive-page tool icons | **Lightning**: local temp address; **Radar**: chain scan; **List**: pick an existing address (all temporary) |
| Settings → Receive addresses | Management list of known receive addresses for this account (copy) |
| Settings → Account preview | Read-only list of derived accounts under this recovery phrase (no watch-only); tap one to inspect receive/change |
| Account structure (drill-down) | Receive + change chains for that account; optional used-address scan with loading |
| Leaving Receive and opening it again | Resets to the first address; temporary is **not** the new default |

Temporary addresses still belong to the same HD account. Gap / discovery cursors may advance so balances on those addresses are included in the account total. The UI default never follows them.

## Why not follow the desktop “new address every Receive open” pattern

The official desktop wallet often rotates the receive address on each receive action (privacy / HD habit).

Pearla talks to the public Blockbook indexer **per address**. Auto-rotating on every open would grow `0…receiveIndex` coverage and make home balance refreshes slower. The extension therefore:

1. Keeps a **stable default** (first receive address) for everyday use.
2. Offers **manual, temporary** rotation via Receive-page icons (local, scan, or pick existing).
3. Does **not** promote a temporary address to the home/default identity; receive lists live under Receive addresses, and receive+change inspection under Account preview → Account structure.

## Implementation notes

- Default display path: `vault.address(0, 0, account)` (also stored as the derived book `item.address`).
- Temporary path: session `tempReceiveIndex` on the Receive screen; cleared when Receive is opened again or the vault locks.
- Primary gold lightning `#newRecv` is the everyday local-cache path. Muted radar `#newRecvScan` is the thorough chain gap scan (loading). Muted list `#pickRecv` opens a drawer of known addresses.
- Settings `#screen-addresses` lists receive indexes `0…receiveIndex` plus locally cached used addresses; copy only.
- Settings `#screen-accounts-preview` lists derived accounts only (watch-only stays in the account drawer); tapping opens `#screen-structure` for that account.
- Structure lists receive `0/i` and change `1/j` from local cursors; “Scan chains for used addresses” runs gap discovery with loading. Change addresses are labeled internal — not for payments. Switching the active account still happens in the account drawer.
- Opening either page does not walk the full indexer by default.
- Temporary hint copy differs by source (local / scan / pick); none become the home default.
- Watch-only accounts hide receive-tool icons; structure explains there is no HD tree and can show the single watched address.

## Related code

- `src/shell.js` — `listKnownReceiveAddresses`, `listAccountStructure`, `openAddressManager`, `openAccountsPreview`, `openAccountStructure`, `openReceivePicker`
- `src/popup.html` — `#newRecv`, `#newRecvScan`, `#pickRecv`, `#recvPickSheet`, `#screen-addresses`, `#screen-accounts-preview`, `#screen-structure`
- `src/vault-directory.js` — account `address` remains `0/0` for identity
