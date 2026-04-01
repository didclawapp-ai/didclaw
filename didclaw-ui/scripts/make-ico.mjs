/**
 * @deprecated Use `pnpm run icons` (regen-icons.mjs). It runs `tauri icon` and
 * regenerates icon.ico together with icns, PNG, iOS, and Android assets from
 * `src-tauri/icons/didclaw-logo.png`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(__dirname, "regen-icons.mjs");
console.log("make-ico.mjs forwards to regen-icons.mjs …");
const r = spawnSync(process.execPath, [script], { stdio: "inherit" });
process.exit(r.status ?? 1);
