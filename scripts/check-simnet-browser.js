import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Script } from "node:vm";
import { setTimeout as delay } from "node:timers/promises";
import { parseHTML } from "linkedom";

// Integration check in a Node DOM/VM. It does not launch Chrome and does not simulate real extension permissions or CORS.
const [binary, option] = process.argv.slice(2);
if (!binary || (option && option !== "--lose-response")) throw new Error("Usage: node scripts/check-simnet-browser.js /path/to/pearld [--lose-response]");
const loseResponse = option === "--lose-response";
await mkdir("artifacts", { recursive: true });
const child = spawn(process.execPath, ["scripts/local-chain.js", binary, "--serve"], { stdio: ["ignore", "pipe", "pipe"] });
const stopped = once(child, "exit").catch(() => {});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });
let startError;
child.on("error", (error) => { startError = error; });
async function until(check) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (check()) return;
    if (startError || child.exitCode !== null) throw new Error("Local bridge exited before the integration check finished");
    await delay(10);
  }
  throw new Error("Local browser script check timed out");
}
let document;
try {
  await until(() => /pairing file: (.+pairing\.json)\./.test(output));
  const pairingPath = output.match(/pairing file: (.+pairing\.json)\./)[1];
  const pairing = JSON.parse(await readFile(pairingPath, "utf8"));
  const html = await readFile("dist-simnet/simnet.html", "utf8");
  const script = new Script(await readFile("dist-simnet/simnet.js", "utf8"), { filename: "simnet.js" });
  const stored = {};
  let queue = Promise.resolve();
  const locks = { request(_key, _options, work) { const result = queue.then(work); queue = result.catch(() => {}); return result; } };
  const requests = [];
  let dropped = false;
  function open() {
    const { document: next } = parseHTML(html);
    script.runInNewContext({ document: next, TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob,
      AbortController, setTimeout, clearTimeout, navigator: { locks },
      chrome: { storage: { local: {
        get(key, callback) { callback(structuredClone({ [key]: stored[key] })); },
        set(value, callback) { Object.assign(stored, structuredClone(value)); callback(); },
      } } },
      async fetch(url, options) {
        requests.push(new URL(url).pathname);
        assert.ok(url.startsWith(`${pairing.url}/`));
        const response = await fetch(url, { ...options,
          headers: { ...options.headers, Origin: `chrome-extension://${"a".repeat(32)}` } });
        if (loseResponse && url.endsWith("/send") && !dropped && response.ok) {
          dropped = true; await response.body.cancel(); throw new Error("simulated lost response after node acceptance");
        }
        return response;
      },
    });
    return next;
  }
  document = open();
  const get = (id) => document.getElementById(`simnet-${id}`);
  async function connect() {
    get("pair").value = pairing.token; get("connect").click();
    await until(() => !get("review").hidden);
  }
  await connect();
  assert.match(get("summary").textContent, /Pearl simnet/);
  get("send").click(); await delay(10);
  assert.equal(requests.includes("/send"), false);
  get("sign-confirm").checked = true; get("sign").click();
  await until(() => get("status").textContent.includes("已签名，尚未广播"));
  assert.equal(requests.includes("/send"), false);
  get("send-confirm").checked = true; get("send").click();
  await until(() => get("status").textContent.includes(loseResponse ? "状态未知" : "已广播"));
  assert.equal(requests.filter((path) => path === "/send").length, 1);
  get("send").click(); await delay(10);
  assert.equal(requests.filter((path) => path === "/send").length, 1);
  const journalKey = `prlSimnetJournal:${pairing.session}`;
  assert.equal(stored[journalKey].status, loseResponse ? "unknown" : "broadcast");
  assert.equal(JSON.stringify(stored).includes(pairing.token), false);
  assert.deepEqual(Object.keys(stored[journalKey]).sort(), ["confirmations", "network", "status", "txid"]);
  document.defaultView.dispatchEvent(new document.defaultView.Event("pagehide"));
  assert.equal(get("summary").textContent, "");
  document = open(); await connect();
  assert.equal(get("sign").disabled, true); assert.equal(get("send").disabled, true);
  get("refresh").click();
  await until(() => get("status").textContent.includes("确认数：1"));
  assert.equal(stored[journalKey].status, "broadcast");
  assert.equal(requests.filter((path) => path === "/send").length, 1);
  const result = { environment: "Node DOM/VM plus real official simnet and HTTP bridge; not Chrome",
    scenario: loseResponse ? "lost-response" : "normal", status: stored[journalKey].status,
    txid: stored[journalKey].txid, confirmations: stored[journalKey].confirmations,
    sendRequests: requests.filter((path) => path === "/send").length, reopened: true };
  await writeFile(`artifacts/p4-browser-${result.scenario}-result.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  document?.defaultView.dispatchEvent(new document.defaultView.Event("pagehide"));
  if (child.exitCode === null && !startError) {
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 7000);
    try { await stopped; } finally { clearTimeout(timer); }
  }
  await writeFile("artifacts/p4-browser-bridge.log", output);
}
