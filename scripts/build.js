import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const simnet = process.argv.includes("--simnet");
const outDir = simnet ? "dist-simnet" : "dist";
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
execFileSync(process.execPath, ["scripts/make-icons.js"], { stdio: "inherit" });

const resultInputs = {};
if (simnet) {
  const result = await build({
    entryPoints: ["src/simnet.js"],
    bundle: true,
    outfile: `${outDir}/simnet.js`,
    format: "iife",
    platform: "browser",
    target: "chrome114",
    minify: true,
    legalComments: "none",
    metafile: true,
    logLevel: "warning",
  });
  Object.assign(resultInputs, result.metafile.inputs);
} else {
  // The store build keeps function names and strips only whitespace and comments, so review can still read it. The simnet build is not uploaded.
  for (const [entry, name] of [["src/popup.js", "popup.js"], ["src/background.js", "background.js"], ["src/offscreen.js", "offscreen.js"]]) {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      outfile: `${outDir}/${name}`,
      format: "iife",
      platform: "browser",
      target: "chrome114",
      minifyIdentifiers: false,
      minifySyntax: false,
      minifyWhitespace: true,
      legalComments: "none",
      metafile: true,
      logLevel: "warning",
    });
    Object.assign(resultInputs, result.metafile.inputs);
  }
  cpSync("src/offscreen.html", `${outDir}/offscreen.html`);
}

const packageRoots = [...new Set(Object.keys(resultInputs)
  .map((input) => input.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[0]).filter(Boolean))].sort();
const notices = packageRoots.map((root) => {
  const metadata = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
  const license = readdirSync(root).find((name) => /^licen[sc]e(?:\..*)?$/i.test(name));
  if (!license) throw new Error(`Missing dependency license: ${metadata.name}`);
  return `${metadata.name} ${metadata.version}\n\n${readFileSync(`${root}/${license}`, "utf8")}`;
});
writeFileSync(`${outDir}/THIRD_PARTY_LICENSES.txt`, notices.join("\n\n--------------------\n\n"));

cpSync(simnet ? "src/simnet.html" : "src/popup.html", simnet ? `${outDir}/simnet.html` : `${outDir}/popup.html`);
cpSync("src/popup.css", `${outDir}/popup.css`);
const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8"));
if (simnet) {
  cpSync("src/simnet.css", `${outDir}/simnet.css`);
  delete manifest.background;
  manifest.permissions = ["storage"];
  manifest.name = "Pearl SIMNET fixture";
  manifest.description = "Local simnet only. Pair, confirm, and broadcast a transaction built from newly mined test coins. Cannot import a wallet or connect to mainnet.";
  manifest.action.default_title = manifest.name;
  manifest.action.default_popup = "simnet.html";
  manifest.host_permissions = ["http://127.0.0.1/*"];
  manifest.content_security_policy.extension_pages += "; connect-src http://127.0.0.1:18765";
}
writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
cpSync("src/icons", `${outDir}/icons`, { recursive: true });
