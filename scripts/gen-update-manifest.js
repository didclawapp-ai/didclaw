#!/usr/bin/env node
/**
 * Generate DidClaw update manifest (didclaw-update.json).
 *
 * Usage:
 *   node scripts/gen-update-manifest.js [options]
 *
 * Options:
 *   --windows  <url>       Windows installer download URL (.exe / .msi)
 *   --macos    <url>       macOS installer download URL (.dmg)
 *   --linux    <url>       Linux installer download URL (.AppImage / .deb)
 *   --notes    <text>      Release notes (inline text)
 *   --notes-file <path>    Read release notes from a file (e.g. RELEASE_NOTES.md)
 *   --version  <semver>    Override version (default: reads lclaw-ui/package.json)
 *   --date     <YYYY-MM-DD> Release date (default: today)
 *   --output   <path>      Write JSON to file instead of stdout
 *
 * Examples:
 *   # Write to stdout, pipe or redirect
 *   node scripts/gen-update-manifest.js \
 *     --windows https://github.com/acme/DidClaw/releases/download/v0.6.0/DidClaw_0.6.0_x64-setup.exe \
 *     --notes "修复若干问题" \
 *     > dist/didclaw-update.json
 *
 *   # Write directly to a file
 *   node scripts/gen-update-manifest.js \
 *     --windows https://example.com/DidClaw_0.6.0_x64-setup.exe \
 *     --notes-file RELEASE_NOTES.md \
 *     --output dist/didclaw-update.json
 *
 *   # GitHub Releases URL pattern (replace <owner>/<repo> and version):
 *   #   https://github.com/<owner>/<repo>/releases/download/v{VERSION}/DidClaw_{VERSION}_x64-setup.exe
 */

const fs = require("fs");
const path = require("path");

// ── Parse args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
};
const has = (flag) => args.includes(flag);

if (has("--help") || has("-h")) {
  console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 30).join("\n"));
  process.exit(0);
}

// ── Version ───────────────────────────────────────────────────────────────────
let version = get("--version");
if (!version) {
  const pkgPath = path.resolve(__dirname, "../didclaw-ui/package.json");
  if (!fs.existsSync(pkgPath)) {
    die("Cannot find didclaw-ui/package.json. Use --version to specify manually.");
  }
  version = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
  if (!version) die("No version field in lclaw-ui/package.json.");
}
version = version.replace(/^v/i, "").trim();

// ── Date ──────────────────────────────────────────────────────────────────────
const date = get("--date") || new Date().toISOString().slice(0, 10);

// ── Notes ─────────────────────────────────────────────────────────────────────
let notes = get("--notes") || "";
const notesFile = get("--notes-file");
if (notesFile) {
  const p = path.resolve(process.cwd(), notesFile);
  if (!fs.existsSync(p)) die(`Notes file not found: ${p}`);
  notes = fs.readFileSync(p, "utf8").trim();
}
notes = notes.trim();

// ── Platform URLs ─────────────────────────────────────────────────────────────
const platforms = {};
const windows = get("--windows");
const macos = get("--macos");
const linux = get("--linux");
if (windows) platforms.windows = windows.trim();
if (macos)   platforms.macos   = macos.trim();
if (linux)   platforms.linux   = linux.trim();

if (Object.keys(platforms).length === 0) {
  warn("No platform URLs provided. Generating manifest without download links.");
}

// ── Build manifest ────────────────────────────────────────────────────────────
const manifest = { version, date };
if (notes)                         manifest.notes     = notes;
if (Object.keys(platforms).length) manifest.platforms = platforms;

const json = JSON.stringify(manifest, null, 2) + "\n";

// ── Output ────────────────────────────────────────────────────────────────────
const output = get("--output");
if (output) {
  const outPath = path.resolve(process.cwd(), output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, json, "utf8");
  log(`✓  Manifest written to: ${outPath}`);
  log(`   version  : ${version}`);
  log(`   date     : ${date}`);
  if (notes) log(`   notes    : ${notes.slice(0, 60)}${notes.length > 60 ? "…" : ""}`);
  for (const [k, v] of Object.entries(platforms)) {
    log(`   ${k.padEnd(8)}: ${v}`);
  }
} else {
  process.stdout.write(json);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg)  { process.stderr.write(msg + "\n"); }
function warn(msg) { process.stderr.write("[warn] " + msg + "\n"); }
function die(msg)  { process.stderr.write("[error] " + msg + "\n"); process.exit(1); }
