import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import electron from "vite-plugin-electron/simple";
import { defineConfig, type UserConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8")) as { version: string };

/** 仅生产构建注入 CSP；开发态 Vite HMR 依赖 unsafe-eval，Electron 仍会提示，属预期 */
function productionCspMeta(): string {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https: http:",
    "connect-src 'self' ws: wss: http: https:",
    "frame-src 'self' data: blob: https:",
    "worker-src 'self' blob:",
  ].join("; ");
  return `    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n`;
}

export default defineConfig(async ({ command }): Promise<UserConfig> => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    {
      name: "lclaw-inject-csp-prod",
      transformIndexHtml(html) {
        if (command !== "build") {
          return html;
        }
        if (html.includes("Content-Security-Policy")) {
          return html;
        }
        return html.replace("<head>", `<head>\n${productionCspMeta()}`);
      },
    },
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
