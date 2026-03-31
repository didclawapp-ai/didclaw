/**
 * Regenerate icon.ico with proper RGBA transparency from source_clean.png.
 *
 * Embeds PNG data directly into ICO (PNG-in-ICO format) so all layers keep
 * their alpha channel. Windows Vista+ and all modern shells support this.
 *
 * Usage: node scripts/make-ico.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ICONS = path.join(ROOT, "src-tauri", "icons");
const SOURCE = path.join(ICONS, "source_clean.png");
const OUT_ICO = path.join(ICONS, "icon.ico");

const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Build a PNG-in-ICO buffer from an array of PNG buffers (sorted small→large). */
function buildPngInIco(pngBuffers) {
  const HEADER = 6;
  const DIR = 16;
  const n = pngBuffers.length;

  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type: 1 = ICO
  header.writeUInt16LE(n, 4);  // image count

  const dirs = pngBuffers.map((buf, i) => {
    // PNG IHDR: bytes 16-23 are width (4) + height (4)
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    const dir = Buffer.alloc(DIR);
    dir.writeUInt8(w >= 256 ? 0 : w, 0);   // width  (0 means 256)
    dir.writeUInt8(h >= 256 ? 0 : h, 1);   // height (0 means 256)
    dir.writeUInt8(0, 2);                   // color count (0 = true color)
    dir.writeUInt8(0, 3);                   // reserved
    dir.writeUInt16LE(1, 4);               // planes
    dir.writeUInt16LE(32, 6);              // bits per pixel
    dir.writeUInt32LE(buf.length, 8);      // image data size (bytes)
    // offset filled after loop
    return { dir, buf };
  });

  // Calculate data offsets
  let offset = HEADER + DIR * n;
  dirs.forEach(({ dir, buf }) => {
    dir.writeUInt32LE(offset, 12);
    offset += buf.length;
  });

  return Buffer.concat([header, ...dirs.map((d) => d.dir), ...dirs.map((d) => d.buf)]);
}

async function main() {
  console.log("Source:", SOURCE);

  const pngBuffers = await Promise.all(
    SIZES.map(async (size) => {
      const buf = await sharp(SOURCE)
        .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha()
        .png({ compressionLevel: 9 })
        .toBuffer();
      console.log(`  ${size}x${size}: ${buf.length} bytes`);
      return buf;
    }),
  );

  const icoBuffer = buildPngInIco(pngBuffers);
  await fs.writeFile(OUT_ICO, icoBuffer);
  console.log(`\nWritten: ${OUT_ICO} (${icoBuffer.length} bytes)`);

  // Verify: extract 256x256 layer corner pixel alpha
  const layer256 = pngBuffers[SIZES.indexOf(256)];
  const meta = await sharp(layer256).metadata();
  console.log(`256x256 layer: ${meta.width}x${meta.height} channels=${meta.channels} hasAlpha=${meta.hasAlpha}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
