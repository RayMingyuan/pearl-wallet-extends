import { err } from "./i18n.js";
import { GRAIN_PER_PRL } from "./amount.js";

export const COINBASE_API_ORIGIN = "https://api.coinbase.com";
export const COINBASE_EXCHANGE_ORIGIN = "https://api.exchange.coinbase.com";
export const COINGECKO_API_ORIGIN = "https://api.coingecko.com";
export const PEARL_USD_PAIR = "PEARL-USD";
export const COINGECKO_PEARL_ID = "pearl-2";

const PRICE_RE = /^(0|[1-9]\d*)(?:\.(\d{1,12}))?$/;

export function parseUsdSpotAmount(amount, source = "unknown") {
  if (typeof amount !== "string" || !PRICE_RE.test(amount.trim())) {
    throw err("err.price.pearlQuoteInvalid");
  }
  const match = PRICE_RE.exec(amount.trim());
  const whole = match[1];
  const fraction = match[2] || "";
  return Object.freeze({
    amount: amount.trim(),
    scaled: BigInt(whole + fraction),
    scale: fraction.length,
    source,
  });
}

/** grains × USD/PEARL, as a display dollar string. The main path does not use float. */
export function formatUsdTotal(grains, spotAmount) {
  if (typeof grains !== "bigint" || grains < 0n) throw err("err.price.balanceMustBeNonNegGrain");
  const price = typeof spotAmount === "string" ? parseUsdSpotAmount(spotAmount) : spotAmount;
  if (!price || typeof price.scaled !== "bigint" || !Number.isInteger(price.scale) || price.scale < 0) {
    throw err("err.price.pearlQuoteInvalid");
  }
  const scale = BigInt(price.scale);
  const denom = GRAIN_PER_PRL * (10n ** scale);
  const micros = (grains * price.scaled * 100_000_000n + denom / 2n) / denom;
  return formatUsdMicros(micros);
}

export function formatUsdSpot(spotAmount) {
  const price = typeof spotAmount === "string" ? parseUsdSpotAmount(spotAmount) : spotAmount;
  const micros = price.scale <= 8
    ? price.scaled * (10n ** BigInt(8 - price.scale))
    : price.scaled / (10n ** BigInt(price.scale - 8));
  return formatUsdMicros(micros);
}

function formatUsdMicros(micros) {
  const negative = micros < 0n;
  let abs = negative ? -micros : micros;
  let decimals = 2;
  if (abs > 0n && abs < 1_000_000n) decimals = 6;
  else if (abs > 0n && abs < 100_000_000n) decimals = 4;
  const step = 10n ** BigInt(8 - decimals);
  abs = (abs + step / 2n) / step;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const body = decimals === 0
    ? whole.toString()
    : `${whole}.${frac.toString().padStart(decimals, "0")}`;
  return `${negative ? "-" : ""}$${body}`;
}

function sourceLabel(source) {
  if (source === "coinbase") return "Coinbase";
  if (source === "coingecko") return "CoinGecko";
  return "";
}

export function formatSpotCaption(spot, { prefix = "Spot" } = {}) {
  if (!spot?.amount) return "";
  const label = sourceLabel(spot.source);
  const price = formatUsdSpot(spot);
  return label ? `${prefix} ${price} · ${label}` : `${prefix} ${price}`;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw err("err.price.notJson");
  }
}

async function fetchFromCoinbaseApp({ fetchImpl, signal, origin = COINBASE_API_ORIGIN }) {
  const response = await fetchImpl(`${origin}/v2/prices/${encodeURIComponent(PEARL_USD_PAIR)}/spot`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal,
  });
  const body = await readJson(response);
  if (!response.ok) throw err("err.price.coinbaseHttp", { status: response.status });
  if (body?.data?.currency != null && body.data.currency !== "USD") {
    throw err("err.price.coinbaseNotUsd");
  }
  return parseUsdSpotAmount(body?.data?.amount, "coinbase");
}

async function fetchFromCoinbaseExchange({ fetchImpl, signal, origin = COINBASE_EXCHANGE_ORIGIN }) {
  const response = await fetchImpl(`${origin}/products/${encodeURIComponent(PEARL_USD_PAIR)}/ticker`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal,
  });
  const body = await readJson(response);
  if (!response.ok) throw err("err.price.coinbaseExchangeHttp", { status: response.status });
  return parseUsdSpotAmount(typeof body?.price === "string" ? body.price : "", "coinbase");
}

async function fetchFromCoinGecko({ fetchImpl, signal, origin = COINGECKO_API_ORIGIN }) {
  const url = `${origin}/api/v3/simple/price?ids=${encodeURIComponent(COINGECKO_PEARL_ID)}&vs_currencies=usd`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal,
  });
  const body = await readJson(response);
  if (!response.ok) throw err("err.price.coingeckoHttp", { status: response.status });
  const usd = body?.[COINGECKO_PEARL_ID]?.usd;
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
    throw err("err.price.coingeckoInvalid");
  }
  // Keep at most 8 decimal places and avoid scientific notation.
  const text = usd >= 1
    ? usd.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
    : usd.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  return parseUsdSpotAmount(text, "coingecko");
}

/** Try Coinbase Exchange, then the Coinbase app, then CoinGecko. */
export async function fetchPearlUsdSpot({
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const sources = [
    () => fetchFromCoinbaseExchange({ fetchImpl, signal }),
    () => fetchFromCoinbaseApp({ fetchImpl, signal }),
    () => fetchFromCoinGecko({ fetchImpl, signal }),
  ];
  let lastError = null;
  for (const run of sources) {
    try {
      return await run();
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : err("err.price.noUsdQuote");
}
