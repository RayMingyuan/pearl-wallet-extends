import { err } from "./i18n.js";
import { DEFAULT_INDEXERS } from "./endpoints.js";
import { getNetwork } from "./networks.js";

export const NETWORK_PREFS_KEY = "prlNetworkPrefs";

const MAINNET = "Pearl mainnet";
const TESTNET = "Pearl testnet";
const DEFAULT_ORIGIN = DEFAULT_INDEXERS[0];
// The official desktop "testnet" actually runs --testnet2. The public indexer is Testnet2 as well.
export const DEFAULT_TESTNET_ORIGIN = "https://blockbook.testnet2.pearlnetwork.net";

const ORIGIN_RE = /^https?:\/\/(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9.-]+)(?::\d{1,5})?$/;

const BUILTIN_ORIGINS = Object.freeze({
  [MAINNET]: DEFAULT_ORIGIN,
  [TESTNET]: DEFAULT_TESTNET_ORIGIN,
});

export function defaultNetworkPrefs() {
  return Object.freeze({
    networkId: MAINNET,
    indexerMode: "default",
    scheme: "https",
    host: "blockbook.pearlresearch.ai",
    port: "",
    origin: DEFAULT_ORIGIN,
  });
}

export function builtinIndexerOrigin(networkId) {
  return BUILTIN_ORIGINS[networkId === TESTNET ? TESTNET : MAINNET];
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function parseIndexerOrigin(scheme, host, port) {
  const proto = scheme === "http" ? "http" : "https";
  const hostname = typeof host === "string" ? host.trim().toLowerCase() : "";
  if (!hostname || /[/?#\s]/.test(hostname) || hostname.includes(":")) {
    throw err("err.network.hostnameInvalid");
  }
  if (!/^(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9.-]+)$/.test(hostname)) {
    throw err("err.network.hostnameInvalid");
  }
  if (proto === "http" && !isLoopbackHost(hostname)) throw err("err.network.httpOnlyLoopback");
  let origin = `${proto}://${hostname}`;
  if (port !== "" && port != null) {
    const n = typeof port === "number" ? port : Number(String(port).trim());
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw err("err.network.portInvalid");
    const implied = proto === "https" ? 443 : 80;
    if (n !== implied) origin += `:${n}`;
  }
  if (!ORIGIN_RE.test(origin)) throw err("err.network.indexerOriginInvalid");
  return origin;
}

export function originToParts(origin) {
  if (typeof origin !== "string" || !ORIGIN_RE.test(origin)) {
    throw err("err.network.indexerOriginInvalid");
  }
  const match = origin.match(/^(https?):\/\/([^/:]+)(?::(\d{1,5}))?$/i);
  if (!match) throw err("err.network.indexerOriginInvalid");
  return {
    scheme: match[1].toLowerCase() === "http" ? "http" : "https",
    host: match[2].toLowerCase(),
    port: match[3] || "",
    origin: `${match[1].toLowerCase()}://${match[2].toLowerCase()}${match[3] ? `:${match[3]}` : ""}`,
  };
}

export function normalizeNetworkPrefs(raw) {
  if (!raw || typeof raw !== "object") return { ...defaultNetworkPrefs() };
  const networkId = raw.networkId === TESTNET ? TESTNET : MAINNET;
  getNetwork(networkId);
  const indexerMode = raw.indexerMode === "custom" ? "custom" : "default";

  if (indexerMode === "default") {
    const origin = builtinIndexerOrigin(networkId);
    const parts = originToParts(origin);
    return {
      networkId,
      indexerMode: "default",
      scheme: parts.scheme,
      host: parts.host,
      port: parts.port,
      origin,
    };
  }

  let origin;
  let scheme = raw.scheme === "http" ? "http" : "https";
  let host = typeof raw.host === "string" ? raw.host.trim() : "";
  let port = raw.port == null ? "" : String(raw.port).trim();
  if (typeof raw.origin === "string" && ORIGIN_RE.test(raw.origin)) {
    const parts = originToParts(raw.origin);
    scheme = parts.scheme;
    host = parts.host;
    port = parts.port;
    origin = parts.origin;
  } else if (host) {
    origin = parseIndexerOrigin(scheme, host, port);
  } else {
    throw err("err.network.customHostRequired");
  }
  if (scheme === "http" && !isLoopbackHost(host.toLowerCase())) throw err("err.network.httpOnlyLoopback");
  return { networkId, indexerMode: "custom", scheme, host, port, origin };
}

export function networkLabel(networkId) {
  if (networkId === TESTNET) return "Pearl 测试网";
  return "Pearl 主网";
}

export function indexerPermissionOrigin(origin) {
  if (typeof origin !== "string" || !ORIGIN_RE.test(origin)) {
    throw err("err.network.indexerOriginInvalid");
  }
  return `${origin}/*`;
}

const LEGACY_TESTNET_ORIGIN = "https://blockbook.testnet.pearlresearch.ai";

export function needsOptionalHostPermission(origin) {
  return origin !== DEFAULT_ORIGIN
    && origin !== DEFAULT_TESTNET_ORIGIN
    && origin !== LEGACY_TESTNET_ORIGIN;
}

export { MAINNET as NETWORK_MAINNET, TESTNET as NETWORK_TESTNET, DEFAULT_ORIGIN, ORIGIN_RE };
