import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS = path.resolve(__dirname, "..", "src-tauri", "icons");
const SRC = path.join(ICONS, "source_clean.png");
const BG = { r: 0, g: 0, b: 0, alpha: 0 };

async function resize(size, outFile) {
  await sharp(SRC)
    .resize(size, size, { fit: "contain", background: BG })
    .ensureAlpha()
    .png({ compressionLevel: 9 })
    .toFile(path.join(ICONS, outFile));
  console.log("  OK", outFile);
}

// ICO builder (PNG-in-ICO, preserves alpha)
async function buildIco() {
  const SIZES = [16, 24, 32, 48, 64, 128, 256];
  const bufs = await Promise.all(
    SIZES.map((s) =>
      sharp(SRC)
        .resize(s, s, { fit: "contain", background: BG })
        .ensureAlpha()
        .png({ compressionLevel: 9 })
        .toBuffer()
    )
  );
  const HEADER = 6;
  const DIR = 16;
  const n = bufs.length;
  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(n, 4);
  let offset = HEADER + DIR * n;
  const dirs = bufs.map((buf) => {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    const dir = Buffer.alloc(DIR);
    dir.writeUInt8(w >= 256 ? 0 : w, 0);
    dir.writeUInt8(h >= 256 ? 0 : h, 1);
    dir.writeUInt8(0, 2);
    dir.writeUInt8(0, 3);
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(buf.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += buf.length;
    return { dir, buf };
  });
  const ico = Buffer.concat([header, ...dirs.map((d) => d.dir), ...dirs.map((d) => d.buf)]);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(ICONS, "icon.ico"), ico);
  console.log("  OK icon.ico");
}

(async () => {
  console.log("Source:", SRC);
  await resize(32,  "32x32.png");
  await resize(64,  "64x64.png");
  await resize(128, "128x128.png");
  await resize(256, "128x128@2x.png");
  await resize(512, "icon.png");
  await resize(30,  "Square30x30Logo.png");
  await resize(44,  "Square44x44Logo.png");
  await resize(71,  "Square71x71Logo.png");
  await resize(89,  "Square89x89Logo.png");
  await resize(107, "Square107x107Logo.png");
  await resize(142, "Square142x142Logo.png");
  await resize(150, "Square150x150Logo.png");
  await resize(284, "Square284x284Logo.png");
  await resize(310, "Square310x310Logo.png");
  await resize(50,  "StoreLogo.png");
  await buildIco();
  console.log("\nAll icons regenerated.");
})().catch((e) => { console.error(e); process.exit(1); });
