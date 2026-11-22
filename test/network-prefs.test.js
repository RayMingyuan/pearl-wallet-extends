import assert from "node:assert/strict";
import test from "node:test";
import { createEndpoints } from "../src/endpoints.js";
import { getNetwork } from "../src/networks.js";
import {
  defaultNetworkPrefs,
  needsOptionalHostPermission,
  normalizeNetworkPrefs,
  parseIndexerOrigin,
} from "../src/network-prefs.js";
import { deriveAddress, secretToSeed } from "../src/keys.js";
import { readFileSync } from "node:fs";

test("defaults to Pearl mainnet with the public Blockbook origin", () => {
  const prefs = defaultNetworkPrefs();
  assert.equal(prefs.networkId, "Pearl mainnet");
  assert.equal(prefs.indexerMode, "default");
  assert.equal(prefs.origin, "https://blockbook.pearlresearch.ai");
  assert.equal(needsOptionalHostPermission(prefs.origin), false);
});

test("accepts custom http host and port for indexer origins", () => {
  assert.equal(parseIndexerOrigin("http", "127.0.0.1", "18332"), "http://127.0.0.1:18332");
  assert.equal(parseIndexerOrigin("https", "indexer.example", "443"), "https://indexer.example");
  assert.equal(parseIndexerOrigin("https", "indexer.example", "8443"), "https://indexer.example:8443");
  const endpoints = createEndpoints(["http://127.0.0.1:18332"]);
  assert.equal(endpoints.selected(), "http://127.0.0.1:18332");
  assert.throws(() => parseIndexerOrigin("https", "bad/host", ""), /hostnameInvalid/);
  assert.throws(() => parseIndexerOrigin("http", "indexer.example", "80"), /httpOnlyLoopback/);
  assert.throws(() => normalizeNetworkPrefs({
    indexerMode: "custom",
    origin: "http://blockbook.example",
  }), /httpOnlyLoopback/);
  assert.throws(() => createEndpoints(["https://indexer.example/path"]), /indexerOriginInvalid/);
});

test("testnet default uses the public Testnet2 Blockbook and official tprl params", () => {
  const prefs = normalizeNetworkPrefs({
    networkId: "Pearl testnet",
    indexerMode: "default",
  });
  assert.equal(prefs.networkId, "Pearl testnet");
  assert.equal(prefs.indexerMode, "default");
  assert.equal(prefs.origin, "https://blockbook.testnet2.pearlnetwork.net");
  assert.equal(needsOptionalHostPermission(prefs.origin), false);
  const params = getNetwork("Pearl testnet");
  assert.equal(params.hrp, "tprl");
  assert.equal(params.coinType, 1);
  assert.equal(params.chain, "testnet2");
  const custom = normalizeNetworkPrefs({
    networkId: "Pearl testnet",
    indexerMode: "custom",
    scheme: "http",
    host: "127.0.0.1",
    port: "9130",
  });
  assert.equal(custom.origin, "http://127.0.0.1:9130");
  assert.equal(needsOptionalHostPermission(custom.origin), true);
  assert.throws(() => normalizeNetworkPrefs({ networkId: "Pearl testnet", indexerMode: "custom" }), /customHostRequired/);
});

test("testnet derivation differs from mainnet beyond the HRP", () => {
  const fixture = JSON.parse(readFileSync(new URL("../src/pearl-v1.5.5.json", import.meta.url), "utf8"));
  const seed = secretToSeed({ kind: "hex", value: fixture.seedHex });
  const main = deriveAddress(seed, 0, 0, "Pearl mainnet");
  const test = deriveAddress(seed, 0, 0, "Pearl testnet");
  assert.match(main, /^prl1/);
  assert.match(test, /^tprl1/);
  assert.notEqual(main.slice(4), test.slice(5));
});
