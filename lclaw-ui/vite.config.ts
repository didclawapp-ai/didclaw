import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import electron from "vite-plugin-electron/simple";
import { defineConfig, type UserConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8")) as { version: string };

export default defineConfig(async (): Promise<UserConfig> => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    vue(),
    ...(await electron({
      main: { entry: "electron/main.ts" },
      preload: { input: "electron/preload.ts" },
    })),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
  },
}));
