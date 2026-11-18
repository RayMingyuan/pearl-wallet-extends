import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchPearlUsdSpot,
  formatSpotCaption,
  formatUsdSpot,
  formatUsdTotal,
  parseUsdSpotAmount,
} from "../src/pearl-price.js";
import { speak } from "../src/i18n.js";

test("parses spot amount without floats", () => {
  assert.deepEqual(parseUsdSpotAmount("0.0123", "coinbase"), {
    amount: "0.0123", scaled: 123n, scale: 4, source: "coinbase",
  });
  assert.deepEqual(parseUsdSpotAmount("12"), { amount: "12", scaled: 12n, scale: 0, source: "unknown" });
  assert.throws(() => parseUsdSpotAmount("1e-2"), (error) => {
    assert.match(speak(error, "en"), /quote/i);
    return true;
  });
});

test("formats wallet USD total and spot caption", () => {
  assert.equal(formatUsdTotal(200_000_000n, "0.5"), "$1.00");
  assert.equal(formatUsdTotal(199_139_538n, "0.05"), "$0.0996");
  assert.equal(formatUsdSpot("1.54"), "$1.54");
  assert.equal(
    formatSpotCaption({ amount: "1.54", scaled: 154n, scale: 2, source: "coingecko" }),
    "Spot $1.54 · CoinGecko",
  );
  assert.equal(
    formatSpotCaption({ amount: "1.54", scaled: 154n, scale: 2, source: "coingecko" }, { prefix: "现价" }),
    "现价 $1.54 · CoinGecko",
  );
});

test("fetchPearlUsdSpot prefers Coinbase Exchange then falls back", async () => {
  const urls = [];
  const spot = await fetchPearlUsdSpot({
    async fetchImpl(url) {
      urls.push(url);
      if (url.includes("api.exchange.coinbase.com")) {
        return { ok: false, status: 404, async json() { return {}; } };
      }
      if (url.includes("api.coinbase.com")) {
        return { ok: false, status: 404, async json() { return {}; } };
      }
      return {
        ok: true,
        status: 200,
        async json() { return { "pearl-2": { usd: 1.54 } }; },
      };
    },
  });
  assert.equal(spot.source, "coingecko");
  assert.equal(spot.amount, "1.54");
  assert.ok(urls.some((url) => url.includes("api.exchange.coinbase.com")));
  assert.ok(urls.some((url) => url.includes("api.coinbase.com")));
  assert.ok(urls.some((url) => url.includes("api.coingecko.com")));
});

test("fetchPearlUsdSpot uses Coinbase Exchange when available", async () => {
  const spot = await fetchPearlUsdSpot({
    async fetchImpl(url) {
      if (url.includes("api.exchange.coinbase.com")) {
        return { ok: true, status: 200, async json() { return { price: "1.559" }; } };
      }
      throw new Error("should not fall through");
    },
  });
  assert.equal(spot.source, "coinbase");
  assert.equal(spot.amount, "1.559");
  assert.equal(formatUsdTotal(100_000_000n, spot), "$1.56");
});
