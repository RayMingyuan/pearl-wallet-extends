import assert from "node:assert/strict";
import test from "node:test";
import { createMainnetStore } from "../src/mainnet-storage.js";
import { LIVE_ADDRESS } from "./samples.js";

function areaFrom(initial = {}) {
  const mem = { ...initial };
  return {
    mem,
    area: {
      async get(key) {
        if (key == null) return { ...mem };
        return mem[key] == null ? {} : { [key]: mem[key] };
      },
      async set(obj) {
        Object.assign(mem, obj);
      },
    },
  };
}

const txid = "ab".repeat(32);
const key = `mainnet:${txid}`;
const changeAddress = "prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4na";
const record = Object.freeze({
  network: "Pearl mainnet",
  txid,
  status: "unknown",
  confirmations: 0,
});

test("mainnet store persists and reads one tx record by txid", async () => {
  const fake = areaFrom();
  const store = createMainnetStore(fake.area);
  assert.equal(await store.get(key), null);
  await store.put(key, record);
  assert.deepEqual(await store.get(key), record);
  assert.deepEqual(Object.keys(fake.mem), [`prlMainnetJournal:${txid}`]);
});

test("mainnet store rejects invalid keys and corrupted records", async () => {
  const fake = areaFrom();
  const store = createMainnetStore(fake.area);
  await assert.rejects(() => store.get("simnet:00"), /journalKeyInvalid/);
  await assert.rejects(() => store.put("mainnet:00", record), /journalKeyInvalid/);
  await assert.rejects(
    () => store.put(key, { ...record, status: "pending" }),
    /journalCorrupt/,
  );
});

test("mainnet store blocks txid mismatch and corrupted persisted entries", async () => {
  const fake = areaFrom({
    [`prlMainnetJournal:${txid}`]: { ...record, txid: "cd".repeat(32) },
  });
  const store = createMainnetStore(fake.area);
  await assert.rejects(() => store.get(key), /journalCorrupt/);
  await assert.rejects(
    () => store.put(key, { ...record, txid: "cd".repeat(32) }),
    /journalCorrupt/,
  );
});

test("mainnet store remembers latest txid per address and reads the mapped record", async () => {
  const fake = areaFrom();
  const store = createMainnetStore(fake.area);
  await store.put(key, record);
  await store.rememberLatest(LIVE_ADDRESS, txid.toUpperCase(), {
    payment: "100860000",
    fee: "424",
    sourceAddress: LIVE_ADDRESS,
    changeAddress,
  });
  assert.equal(fake.mem[`prlMainnetLastByAddress:${LIVE_ADDRESS}`], txid);
  assert.equal(fake.mem[`prlMainnetLastByAddress:${changeAddress}`], txid);
  assert.deepEqual(fake.mem[`prlMainnetSpendHint:${txid}`], {
    txid,
    payment: "100860000",
    fee: "424",
    sourceAddress: LIVE_ADDRESS,
    changeAddress,
  });
  assert.deepEqual(await store.getLatestForAddress(LIVE_ADDRESS), record);
  assert.deepEqual(await store.getLatestSpendHintForAddress(LIVE_ADDRESS), {
    txid,
    payment: "100860000",
    fee: "424",
    sourceAddress: LIVE_ADDRESS,
    changeAddress,
  });
  assert.deepEqual((await store.getLatestAddressGroupForAddress(LIVE_ADDRESS)).sort(), [LIVE_ADDRESS, changeAddress].sort());
  assert.deepEqual((await store.getLatestAddressGroupForAddress(changeAddress)).sort(), [changeAddress, LIVE_ADDRESS].sort());
});

test("mainnet store can link a legacy peer address to latest txid for group balance", async () => {
  const fake = areaFrom();
  const store = createMainnetStore(fake.area);
  await store.put(key, record);
  await store.rememberLatest(LIVE_ADDRESS, txid);
  assert.deepEqual(await store.getLatestAddressGroupForAddress(LIVE_ADDRESS), [LIVE_ADDRESS]);
  assert.equal(await store.linkLatestAddresses(LIVE_ADDRESS, changeAddress), true);
  assert.equal(fake.mem[`prlMainnetLastByAddress:${changeAddress}`], txid);
  const group = await store.getLatestAddressGroupForAddress(LIVE_ADDRESS);
  assert.equal(group.includes(LIVE_ADDRESS), true);
  assert.equal(group.includes(changeAddress), true);
});

test("mainnet store rejects malformed address index and txid mapping", async () => {
  const fake = areaFrom({
    [`prlMainnetLastByAddress:${LIVE_ADDRESS}`]: "not-a-txid",
  });
  const store = createMainnetStore(fake.area);
  await assert.rejects(() => store.rememberLatest("invalid", txid), /addressInvalid/);
  await assert.rejects(() => store.rememberLatest(LIVE_ADDRESS, "zz"), /txidInvalid/);
  await assert.rejects(() => store.rememberLatest(LIVE_ADDRESS, txid, { payment: "0", fee: "1" }), /spendHintInvalid/);
  await assert.rejects(() => store.rememberLatest(LIVE_ADDRESS, txid, {
    payment: "1",
    fee: "1",
    sourceAddress: LIVE_ADDRESS,
    changeAddress: LIVE_ADDRESS,
  }), /spendHintInvalid/);
  await assert.rejects(() => store.getLatestForAddress(LIVE_ADDRESS), /txidInvalid/);
});

test("mainnet store rejects corrupted latest spend hint payload", async () => {
  const fake = areaFrom({
    [`prlMainnetLastByAddress:${LIVE_ADDRESS}`]: txid,
    [`prlMainnetSpendHint:${txid}`]: { txid, payment: "-1", fee: "1" },
  });
  const store = createMainnetStore(fake.area);
  await assert.rejects(() => store.getLatestSpendHintForAddress(LIVE_ADDRESS), /notInteger/);
});
