import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const ASSET_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".webp": "image/webp",
};

function safeFileUnderDist(distResolved: string, pathname: string): string | null {
  let rel = decodeURIComponent(pathname.split("?")[0] ?? "/");
  if (rel.startsWith("/")) {
    rel = rel.slice(1);
  }
  if (!rel || rel.endsWith("/")) {
    rel = rel ? `${rel}index.html` : "index.html";
  }
  const abs = path.resolve(path.join(distResolved, rel));
  if (abs !== distResolved && !abs.startsWith(distResolved + path.sep)) {
    return null;
  }
  return abs;
}

function createStaticServer(distDir: string): http.Server {
  const distResolved = path.resolve(distDir);
  return http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    try {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      let filePath = safeFileUnderDist(distResolved, u.pathname);
      if (!filePath) {
        res.writeHead(403).end();
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distResolved, "index.html");
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404).end();
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mime = ASSET_MIME[ext] ?? "application/octet-stream";
      res.setHeader("Content-Type", mime);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = fs.createReadStream(filePath);
      stream.on("error", () => {
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
      stream.pipe(res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500).end();
      }
    }
  });
}

/**
 * 绑定 127.0.0.1，避免 file:// 导致 Gateway WebSocket 校验 Origin 失败（1008）。
 * 默认端口 34127，环境变量 LCLAW_UI_STATIC_PORT 可覆盖；占用则顺序尝试后续端口。
 */
export async function startProdStaticServer(distDir: string): Promise<{
  server: http.Server;
  origin: string;
}> {
  const basePort = Number(process.env.LCLAW_UI_STATIC_PORT || 34127);
  if (!Number.isFinite(basePort) || basePort < 1 || basePort > 65535) {
    throw new Error("LCLAW_UI_STATIC_PORT 无效");
  }
  for (let p = basePort; p < basePort + 40; p++) {
    const server = createStaticServer(distDir);
    try {
      await new Promise<void>((resolve, reject) => {
        const onErr = (err: Error) => {
          server.close(() => reject(err));
        };
        server.once("error", onErr);
        server.listen(p, "127.0.0.1", () => {
          server.off("error", onErr);
          resolve();
        });
      });
      return { server, origin: `http://127.0.0.1:${p}` };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "EADDRINUSE") {
        throw e;
      }
    }
  }
  throw new Error("无可用端口启动本地静态服务");
}
