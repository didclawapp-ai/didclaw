/**
 * Regenerate all Tauri bundle icons from `src-tauri/icons/didclaw-logo.png`.
 *
 * `tauri icon` requires a square raster; this script letterboxes the logo onto
 * a transparent 1024×1024 canvas, then delegates to the CLI (icns, ico, PNG,
 * iOS, Android, Windows Appx tiles).
 *
 * Usage: pnpm run icons
 */
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ICONS = path.join(ROOT, "src-tauri", "icons");
/** Canonical marketing / source asset (may be non-square). */
const SRC = path.join(ICONS, "didclaw-logo.png");
const BG = { r: 0, g: 0, b: 0, alpha: 0 };

/** Fail if bundle outputs were not just written (catches wrong -o path or partial runs). */
function assertFreshOutputs(startedAtMs) {
  const names = ["icon.ico", "icon.icns", "32x32.png", "128x128.png", "icon.png"];
  const skewMs = 15_000;
  for (const name of names) {
    const p = path.join(ICONS, name);
    if (!existsSync(p)) {
      console.error(`Missing expected output: ${p}`);
      process.exit(1);
    }
    const mtime = statSync(p).mtimeMs;
    if (mtime + 500 < startedAtMs - skewMs) {
      console.error(
        `Output looks stale (not refreshed this run): ${name} mtime=${new Date(mtime).toISOString()}`,
      );
      process.exit(1);
    }
  }
}

function logMtimes(label, paths) {
  console.log(label);
  for (const rel of paths) {
    const p = path.join(ICONS, rel);
    if (!existsSync(p)) {
      console.log(`  (missing) ${rel}`);
      continue;
    }
    const st = statSync(p);
    console.log(`  ${rel}  ${st.mtime.toISOString()}  ${st.size} B`);
  }
}

(async () => {
  if (!existsSync(SRC)) {
    console.error("Missing source:", SRC);
    process.exit(1);
  }

  const runStarted = Date.now();
  const tmpSquare = path.join(os.tmpdir(), `didclaw-icon-square-${process.pid}.png`);
  console.log("Source:", SRC);
  console.log(
    "Tip: after replacing didclaw-logo.png, run `pnpm run icons` again so ICO/ICNS/PNGs match.",
  );
  console.log("Square (temp):", tmpSquare);

  await sharp(SRC)
    .resize(1024, 1024, { fit: "contain", background: BG })
    .ensureAlpha()
    .png({ compressionLevel: 9 })
    .toFile(tmpSquare);

  try {
    const q = (s) => `"${s.replace(/"/g, '\\"')}"`;
    execSync(`pnpm exec tauri icon ${q(tmpSquare)} -o ${q(ICONS)}`, {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
    });
  } finally {
    await unlink(tmpSquare).catch(() => {});
  }

  assertFreshOutputs(runStarted);
  console.log("\nDone. Outputs under:", ICONS);
  logMtimes("Key bundle files:", [
    "didclaw-logo.png",
    "icon.ico",
    "icon.icns",
    "32x32.png",
    "icon.png",
  ]);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
