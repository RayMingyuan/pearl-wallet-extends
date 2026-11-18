import { err } from "./i18n.js";
/** 1 PEARL = 100_000_000 grain. Blockbook reports decimals = 8. Never use floats. */
export const GRAIN_PER_PRL = 100_000_000n;

const UNSIGNED_GRAIN = /^(0|[1-9]\d*)$/;
const SIGNED_GRAIN = /^-?(0|[1-9]\d*)$/;

export function parseUnsignedGrain(value, field) {
  if (typeof value !== "string" || !UNSIGNED_GRAIN.test(value)) {
    throw err("err.amount.notInteger", { field });
  }
  return BigInt(value);
}

export function parseSignedGrain(value, field) {
  if (typeof value !== "string" || !SIGNED_GRAIN.test(value)) {
    throw err("err.amount.notInteger", { field });
  }
  return BigInt(value);
}

export function formatGrains(grains) {
  if (typeof grains !== "bigint") {
    throw err("err.amount.mustBeIntegerGrain");
  }
  const negative = grains < 0n;
  const abs = negative ? -grains : grains;
  const whole = abs / GRAIN_PER_PRL;
  const fraction = abs % GRAIN_PER_PRL;
  let text = whole.toString();
  if (fraction !== 0n) {
    text += `.${fraction.toString().padStart(8, "0").replace(/0+$/, "")}`;
  }
  return negative ? `-${text}` : text;
}

/** Compact list and home display: keep at most maxDecimals digits, round, then strip trailing zeros. */
export function formatGrainsCompact(grains, maxDecimals = 4) {
  if (typeof grains !== "bigint") {
    throw err("err.amount.mustBeIntegerGrain");
  }
  if (!Number.isInteger(maxDecimals) || maxDecimals < 0 || maxDecimals > 8) {
    throw err("err.amount.decimalsInvalid");
  }
  if (maxDecimals === 8) return formatGrains(grains);
  const negative = grains < 0n;
  const abs = negative ? -grains : grains;
  const step = 10n ** BigInt(8 - maxDecimals);
  const rounded = ((abs + step / 2n) / step) * step;
  const whole = rounded / GRAIN_PER_PRL;
  const fraction = rounded % GRAIN_PER_PRL;
  let text = whole.toString();
  if (fraction !== 0n && maxDecimals > 0) {
    const trimmed = fraction.toString().padStart(8, "0").slice(0, maxDecimals).replace(/0+$/, "");
    if (trimmed) text += `.${trimmed}`;
  }
  return negative ? `-${text}` : text;
}
