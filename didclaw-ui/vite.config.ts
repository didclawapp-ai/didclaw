import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type UserConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8")) as { version: string };

/**
 * 仅生产构建注入 CSP。
 *
 * 桌面 Tauri 应用特殊要求：
 * - script-src 'unsafe-inline'：index.html 内联主题初始化脚本（无 src）
 * - script-src 'unsafe-eval'：vue-i18n v9 运行时编译带插值的消息字符串使用 new Function()
 * - connect-src http://ipc.localhost：Tauri 2 IPC 协议（从 http:// Origin 加载时使用此协议）
 *
 * 注意：这是桌面壳，内容均来自本地，unsafe-eval/unsafe-inline 的安全风险远小于 Web。
 */
function productionCspMeta(): string {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' ws://127.0.0.1:* wss://127.0.0.1:* http://127.0.0.1:* http://ipc.localhost https:",
    "frame-src 'self' blob: https:",
    "worker-src 'self' blob:",
  ].join("; ");
  return `    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n`;
}

export default defineConfig(({ command }): UserConfig => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    {
      name: "didclaw-inject-csp-prod",
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
