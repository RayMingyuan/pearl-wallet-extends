import { err } from "./i18n.js";
// rprl is shared by official regtest and simnet, so the node chain name must be checked. An address alone does not identify the network.
// tprl testnet uses a different coin type from mainnet, so every derived address changes after a switch.
const networks = Object.freeze({
  "Pearl mainnet": Object.freeze({ name: "Pearl mainnet", chain: "mainnet", hrp: "prl", coinType: 808276 }),
  // Matches the official desktop "testnet": the UI says testnet, while the node and indexer are testnet2. The HRP remains tprl.
  "Pearl testnet": Object.freeze({ name: "Pearl testnet", chain: "testnet2", hrp: "tprl", coinType: 1 }),
  "Pearl regtest": Object.freeze({ name: "Pearl regtest", chain: "regtest", hrp: "rprl", coinType: 1 }),
  "Pearl simnet": Object.freeze({ name: "Pearl simnet", chain: "simnet", hrp: "rprl", coinType: 1 }),
});

export function getNetwork(name = "Pearl mainnet") {
  if (!Object.hasOwn(networks, name)) throw err("err.network.unsupported");
  return networks[name];
}

// Each public network has a Blockbook explorer with the same /tx/{txid} page. Local chains have none, so they get no link.
const explorers = /* @__PURE__ */ Object.freeze({
  "Pearl mainnet": "https://blockbook.pearlresearch.ai",
  "Pearl testnet": "https://blockbook.testnet2.pearlnetwork.net",
});

export function explorerTxUrl(network, txid) {
  if (!Object.hasOwn(explorers, network) || !/^[0-9a-f]{64}$/.test(txid)) return "";
  return `${explorers[network]}/tx/${txid}`;
}
