/** Public coinbase output from Pearl block 139533, read from Blockbook on 2026-11-07. Not a wallet controlled by this project. */
export const LIVE_ADDRESS = "prl1puv0gqv4x0wd0ylwz086y3sqrg4a6umza9r08aecehjrmdqq7mctsmqaqsh";
export const LIVE_PROGRAM_HEX = "e31e8032a67b9af27dc279f448c003457bae6c5d28de7ee719bc87b6801ede17";

export const TX_A = "11".repeat(32);
export const TX_B = "22".repeat(32);

export function tx({ txid = TX_A, vin = [], vout = [], confirmations = 3, blockTime = 1_700_000_000 } = {}) {
  return { txid, vin, vout, confirmations, blockTime };
}
