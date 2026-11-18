import assert from "node:assert/strict";
import test from "node:test";
import {
  err,
  speak,
  packMessage,
  unpackMessage,
} from "../src/i18n.js";

test("err packs stable i18n transport strings", () => {
  const plain = err("err.vault.wrongPassword");
  assert.equal(plain.message, "i18n:err.vault.wrongPassword");
  assert.equal(plain.key, "err.vault.wrongPassword");
  assert.equal(plain.name, "AppError");

  const withVars = err("err.amount.notInteger", { field: "amount" });
  assert.equal(withVars.message, 'i18n:err.amount.notInteger:{"field":"amount"}');
  assert.deepEqual(withVars.vars, { field: "amount" });
});

test("unpackMessage round-trips keys and vars", () => {
  assert.deepEqual(unpackMessage("i18n:err.vault.unlockRequired"), {
    key: "err.vault.unlockRequired",
    vars: undefined,
  });
  assert.deepEqual(unpackMessage(packMessage("err.blockbook.utxoHttp", { status: 404 })), {
    key: "err.blockbook.utxoHttp",
    vars: { status: 404 },
  });
});

test("speak respects locale for err.* catalog entries", () => {
  assert.match(speak(err("err.vault.wrongPassword"), "en"), /Wrong password/);
  assert.match(speak(err("err.vault.wrongPassword"), "zh"), /密码错误/);
});