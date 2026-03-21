import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createConnection } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

/** 从 WebSocket 地址得到用于探测网关是否已监听的 TCP 目标；非本机地址返回 null（不自动拉起）。 */
export function parseGatewayWsTcpTarget(wsUrl: string): { host: string; port: number } | null {
  let u: URL;
  try {
    u = new URL(wsUrl.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "ws:" && u.protocol !== "wss:") {
    return null;
  }
  if (!isLoopbackHost(u.hostname)) {
    return null;
  }
  let port = u.port ? Number.parseInt(u.port, 10) : NaN;
  if (!Number.isFinite(port) || port <= 0) {
    port = u.protocol === "wss:" ? 443 : 18789;
  }
  return { host: u.hostname, port };
}

function probePortOnce(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function waitForTcpPortOpen(
  host: string,
  port: number,
  totalMs: number,
  intervalMs = 350,
): Promise<boolean> {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    const slice = Math.min(2000, deadline - Date.now());
    if (slice <= 0) {
      break;
    }
    if (await probePortOnce(host, port, slice)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export async function resolveOpenClawExecutable(customPath?: string): Promise<string | null> {
  const trimmed = customPath?.trim();
  if (trimmed) {
    try {
      await fs.promises.access(trimmed);
      return trimmed;
    } catch {
      return null;
    }
  }
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("where.exe", ["openclaw"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 8000,
      });
      const line = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);
      if (line) {
        try {
          await fs.promises.access(line);
          return line;
        } catch {
          /* 继续 */
        }
      }
    } catch {
      /* 继续 */
    }
  }
  try {
    await execFileAsync("openclaw", ["--version"], { timeout: 8000, windowsHide: true });
    return "openclaw";
  } catch {
    return null;
  }
}

let managedChild: ChildProcess | null = null;
let ensureInFlight: Promise<{ ok: true; started: boolean } | { ok: false; error: string }> | null =
  null;

function killManagedGatewayProcess(): void {
  if (managedChild && !managedChild.killed) {
    try {
      managedChild.kill();
    } catch {
      /* ignore */
    }
  }
  managedChild = null;
}

/** 应用退出时调用：若用户在 gateway-local.json 中开启「退出时结束本应用启动的网关」，则结束子进程。 */
export function disposeManagedOpenClawGateway(configPath: string): void {
  let killOnQuit = false;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const j = JSON.parse(raw) as Record<string, unknown>;
    killOnQuit = j.stopManagedGatewayOnQuit === true;
  } catch {
    /* 无文件或损坏则视为不结束 */
  }
  if (killOnQuit) {
    killManagedGatewayProcess();
  }
}

export type EnsureGatewayOpts = {
  wsUrl: string;
  autoStart?: boolean;
  openclawExecutable?: string;
};

export async function ensureOpenClawGatewayRunning(
  opts: EnsureGatewayOpts,
): Promise<{ ok: true; started: boolean } | { ok: false; error: string }> {
  const target = parseGatewayWsTcpTarget(opts.wsUrl);
  if (!target) {
    return { ok: true, started: false };
  }
  if (opts.autoStart === false) {
    return { ok: true, started: false };
  }

  if (await waitForTcpPortOpen(target.host, target.port, 500)) {
    return { ok: true, started: false };
  }

  if (ensureInFlight) {
    return ensureInFlight;
  }

  ensureInFlight = (async () => {
    try {
      const exe = await resolveOpenClawExecutable(opts.openclawExecutable);
      if (!exe) {
        return {
          ok: false,
          error:
            "未找到 openclaw。请先安装 OpenClaw 并确保终端能执行 openclaw，或在「本机设置 → 连助手」填写 openclaw 的完整路径（如 npm 全局目录下的 openclaw.cmd）。",
        };
      }

      /**
       * Windows 上 npm 全局命令多为 .cmd，直接 spawn 可执行文件常会失败（需经 cmd 解释）。
       * 使用 shell:true + windowsHide 与终端里输入 openclaw gateway 行为一致。
       */
      const useWinShell = process.platform === "win32";
      const child = spawn(exe, ["gateway"], {
        detached: false,
        windowsHide: true,
        stdio: "ignore",
        env: process.env,
        shell: useWinShell,
      });

      let spawnFailMessage = "";
      const spawned = await new Promise<boolean>((resolve) => {
        child.once("error", (e) => {
          spawnFailMessage = e instanceof Error ? e.message : String(e);
          resolve(false);
        });
        child.once("spawn", () => resolve(true));
      });
      if (!spawned) {
        const detail = spawnFailMessage.trim();
        return {
          ok: false,
          error: detail
            ? `无法启动 openclaw gateway（进程创建失败）：${detail}`
            : "无法启动 openclaw gateway（进程创建失败）。",
        };
      }

      managedChild = child;
      child.on("exit", () => {
        if (managedChild === child) {
          managedChild = null;
        }
      });

      const up = await waitForTcpPortOpen(target.host, target.port, 45_000);
      if (!up) {
        killManagedGatewayProcess();
        return {
          ok: false,
          error: `已在后台执行 openclaw gateway，但端口 ${target.port} 在超时内仍未就绪。请检查本机防火墙、openclaw.json 里的 gateway.port 是否与连接地址一致。`,
        };
      }
      return { ok: true, started: true };
    } finally {
      ensureInFlight = null;
    }
  })();

  return ensureInFlight;
}
