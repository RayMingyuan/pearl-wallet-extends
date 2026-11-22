import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
  applyDom,
  catalogs,
  DEFAULT_LOCALE,
  getLocale,
  normalizeLocale,
  setLocale,
  t,
} from "../src/i18n.js";

test("normalizeLocale maps zh variants and defaults to en", () => {
  assert.equal(normalizeLocale("zh"), "zh");
  assert.equal(normalizeLocale("zh-CN"), "zh");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("fr"), "en");
  assert.equal(normalizeLocale(undefined), DEFAULT_LOCALE);
});

test("t follows setLocale and applyDom updates fragment text", () => {
  setLocale("en");
  assert.equal(getLocale(), "en");
  assert.equal(t("nav.assets"), catalogs.en["nav.assets"]);

  setLocale("zh");
  assert.equal(t("nav.assets"), catalogs.zh["nav.assets"]);

  const { document } = parseHTML('<div><span data-i18n="nav.settings"></span></div>');
  applyDom(document);
  assert.equal(document.querySelector("[data-i18n]").textContent, catalogs.zh["nav.settings"]);

  setLocale("en");
  applyDom(document);
  assert.equal(document.querySelector("[data-i18n]").textContent, catalogs.en["nav.settings"]);
});

test("en and zh catalogs share the same keys including update copy", () => {
  const enKeys = Object.keys(catalogs.en).sort();
  const zhKeys = Object.keys(catalogs.zh).sort();
  assert.deepEqual(zhKeys, enKeys);
  assert.ok(enKeys.includes("settings.version"));
  assert.ok(enKeys.includes("update.reload"));
  assert.match(t("update.banner", { version: "1.0.2" }, "en"), /1\.0\.2/);
  assert.match(t("update.banner", { version: "1.0.2" }, "zh"), /1\.0\.2/);
});
