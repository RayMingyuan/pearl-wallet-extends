import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve("artifacts");
const simnet = process.argv.includes("--simnet");
const version = process.argv.slice(2).find((arg) => arg !== "--simnet");
if (!simnet && !/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  throw new Error("用法：npm run pack -- <版本号>，例如 npm run pack -- 1.0.0");
}
const outFile = `${outDir}/${simnet ? "pearl-pocket-simnet" : `pearla-release-v${version}`}.zip`;
mkdirSync(outDir, { recursive: true });
rmSync(outFile, { force: true });
execFileSync("zip", ["-r", "-q", "-X", outFile, "."], { cwd: simnet ? "dist-simnet" : "dist" });
const info = statSync(outFile);
if (info.size < 1000) {
  throw new Error("扩展压缩包过小");
}
console.log(outFile);
