/**
 * Run after `pnpm dist:win` to generate didclaw-update.json.
 *
 * Reads version from package.json, constructs GitHub Releases download URLs,
 * and writes the manifest to the repo root dist/ directory.
 *
 * Usage: node scripts/post-dist-win.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const GITHUB_REPO = "didclawapp-ai/didclaw";
const GITHUB_BASE = `https://github.com/${GITHUB_REPO}/releases/download`;

// Read version from package.json
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
const version = pkg.version.replace(/^v/i, "").trim();
const tag = `v${version}`;

// Construct GitHub Releases URLs (Tauri default naming)
const exeUrl  = `${GITHUB_BASE}/${tag}/didclaw_${version}_x64-setup.exe`;
const msiUrl  = `${GITHUB_BASE}/${tag}/didclaw_${version}_x64_en-US.msi`;

const manifest = {
  version,
  date: new Date().toISOString().slice(0, 10),
  platforms: {
    windows: exeUrl,
    windows_msi: msiUrl,
  },
};

const outDir  = path.join(ROOT, "dist");
const outFile = path.join(outDir, "didclaw-update.json");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`✓  didclaw-update.json written`);
console.log(`   version : ${version}`);
console.log(`   exe     : ${exeUrl}`);
console.log(`   msi     : ${msiUrl}`);
console.log(`   output  : ${outFile}`);
