<script setup lang="ts">
import { didclawKvReadSync, didclawKvWriteSync } from "@/lib/didclaw-kv";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import { useGatewayStore } from "@/stores/gateway";
import { onMounted, ref } from "vue";

/** 用户点「稍后」后，对该 npm 版本不再提示，直至出现更新的 latest */
const DISMISS_KEY = "didclaw.openclawUpdate.dismissedLatest";

const open = ref(false);
const currentVersion = ref("");
const latestVersion = ref("");
const registryError = ref<string | null>(null);
const platform = ref("");
const upgradeBusy = ref(false);
/** upgrade done — show restart prompt instead of the update notice */
const upgradeSuccess = ref(false);
const upgradeError = ref<string | null>(null);
const upgradeLogTail = ref<string | null>(null);
const restartBusy = ref(false);
const restartDone = ref(false);
const restartError = ref<string | null>(null);
const restartMessage = ref<string | null>(null);

const gw = useGatewayStore();

onMounted(() => {
  if (!isDidClawElectron()) {
    return;
  }
  window.setTimeout(() => {
    void checkOnce();
  }, 5_000);
});

async function checkOnce(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.checkOpenclawUpdate) {
    return;
  }
  try {
    const raw = await api.checkOpenclawUpdate();
    if (!raw || typeof raw !== "object" || !("ok" in raw) || raw.ok !== true) {
      return;
    }
    if (!raw.exeFound || !raw.updateAvailable || !raw.latestVersion?.trim()) {
      return;
    }
    const lv = raw.latestVersion.trim();
    try {
      if (didclawKvReadSync(DISMISS_KEY) === lv) {
        return;
      }
    } catch {
      /* 隐私模式等 */
    }
    currentVersion.value = raw.currentVersion?.trim() || "（未知）";
    latestVersion.value = lv;
    registryError.value =
      typeof raw.registryError === "string" && raw.registryError.trim()
        ? raw.registryError.trim()
        : null;
    platform.value = (raw.platform || "").trim() || "unknown";
    open.value = true;
  } catch {
    /* 忽略网络/IPC 错误 */
  }
}

function dismissForThisRelease(): void {
  const lv = latestVersion.value.trim();
  if (lv) {
    try {
      didclawKvWriteSync(DISMISS_KEY, lv);
    } catch {
      /* ignore */
    }
  }
  open.value = false;
  upgradeSuccess.value = false;
  upgradeError.value = null;
  upgradeLogTail.value = null;
  restartError.value = null;
  restartMessage.value = null;
  restartDone.value = false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function extractUpgradeLogTail(log: string | null | undefined): string | null {
  if (typeof log !== "string" || !log.trim()) {
    return null;
  }
  const lines = log
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && line !== "--- streamed ---");
  if (!lines.length) {
    return null;
  }
  return lines.slice(-6).join("\n");
}

function formatUpgradeFailure(res: {
  error?: string | null;
  exitCode: number;
  log?: string | null;
}): string {
  const err =
    typeof res.error === "string" && res.error.trim() ? res.error.trim() : `退出码 ${res.exitCode}`;
  const tail = extractUpgradeLogTail(res.log);
  upgradeLogTail.value = tail;
  return tail ? `${err}。日志末尾已附上。` : err;
}

async function onWindowsScriptUpgrade(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.runEnsureOpenclawWindowsInstall) {
    window.alert("当前环境无法调用内置升级脚本。");
    return;
  }
  upgradeBusy.value = true;
  upgradeError.value = null;
  upgradeLogTail.value = null;
  let gatewayStopped = false;
  try {
    if (api.stopOpenClawGateway) {
      gw.disconnect();
      restartMessage.value = "正在停止当前 Gateway…";
      const stopRes = await api.stopOpenClawGateway();
      if (!stopRes?.ok) {
        upgradeError.value = stopRes?.error ?? "停止 Gateway 失败";
        window.setTimeout(() => {
          gw.connect();
        }, 800);
        return;
      }
      gatewayStopped = true;
    }
    restartMessage.value = "正在升级 OpenClaw…";
    // upgrade: true → -Upgrade -SkipOnboard → always runs npm install + openclaw doctor
    const res = await api.runEnsureOpenclawWindowsInstall({ skipOnboard: true, upgrade: true });
    if (res.ok) {
      dismissForThisRelease();
      upgradeSuccess.value = true;
      open.value = true;
      currentVersion.value = latestVersion.value || currentVersion.value;
      restartMessage.value = "升级完成，正在重启 Gateway 并恢复连接…";
      await onRestartGateway(true);
    } else {
      upgradeError.value = formatUpgradeFailure(res);
      restartMessage.value = null;
      if (gatewayStopped) {
        window.setTimeout(() => {
          gw.connect();
        }, 1_200);
      }
    }
  } catch (error) {
    upgradeError.value = error instanceof Error ? error.message : "升级过程中出现未知错误";
    restartMessage.value = null;
    if (gatewayStopped) {
      window.setTimeout(() => {
        gw.connect();
      }, 1_200);
    }
  } finally {
    upgradeBusy.value = false;
  }
}

async function waitForGatewayConnected(timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const isConnected = () => gw.status === "connected";
  while (Date.now() < deadline) {
    if (isConnected()) {
      await delay(800);
      return true;
    }
    await delay(500);
  }
  return false;
}

async function onRestartGateway(auto = false): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.restartOpenClawGateway) {
    restartError.value = "当前环境不支持自动重启 Gateway，请稍后手动重启。";
    return;
  }
  restartBusy.value = true;
  restartError.value = null;
  restartDone.value = false;
  restartMessage.value = auto ? "正在重启 Gateway…" : "正在重启 Gateway…";
  try {
    const result = await api.restartOpenClawGateway();
    if (!result?.ok) {
      restartError.value = (result as { error?: string }).error ?? "重启 Gateway 失败";
      restartMessage.value = null;
      return;
    }
    restartMessage.value = "Gateway 已重启，正在恢复桌面端连接…";
    restartDone.value = true;
    await gw.reloadConnection();
    const reconnected = await waitForGatewayConnected();
    if (!reconnected) {
      restartDone.value = false;
      restartError.value = "Gateway 已重启，但桌面端暂未恢复连接，请稍后重试。";
      restartMessage.value = null;
      return;
    }
    restartDone.value = true;
    restartMessage.value = "网关已重启，桌面端连接已恢复。";
  } finally {
    restartBusy.value = false;
  }
}

function onRestartGatewayClick(): void {
  void onRestartGateway(false);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ocu-backdrop" role="presentation" @click.self="dismissForThisRelease">
      <div
        class="ocu-panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="upgradeSuccess ? 'ocu-title-done' : 'ocu-title'"
        @click.stop
      >
        <!-- ── 升级成功：重启网关面板 ── -->
        <template v-if="upgradeSuccess">
          <div class="ocu-done-icon">✓</div>
          <h2 id="ocu-title-done" class="ocu-title">升级完成</h2>
          <p class="ocu-note small muted">
            OpenClaw 已更新至最新版本，配置迁移（<code>openclaw doctor</code>）已自动执行。
            DidClaw 会自动重启网关并恢复连接。
          </p>
          <p v-if="restartMessage" class="ocu-note small">{{ restartMessage }}</p>
          <p v-if="restartDone" class="ocu-restart-ok small">
            网关已重启，桌面端已重新连接到最新版本的 OpenClaw。
          </p>
          <p v-if="restartError" class="ocu-error small">{{ restartError }}</p>
          <div class="ocu-actions">
            <button
              v-if="!restartDone"
              type="button"
              class="lc-btn lc-btn-primary lc-btn-sm"
              :disabled="restartBusy"
              @click="onRestartGatewayClick"
            >
              {{ restartBusy ? "正在恢复连接…" : "重新尝试重启网关" }}
            </button>
            <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" @click="dismissForThisRelease">
              {{ restartDone ? "关闭" : "稍后手动处理" }}
            </button>
          </div>
        </template>

        <!-- ── 发现新版本：升级提示面板 ── -->
        <template v-else>
          <h2 id="ocu-title" class="ocu-title">发现 OpenClaw 新版本</h2>
          <p class="ocu-versions">
            当前：<strong>{{ currentVersion }}</strong>
            · 最新：<strong>{{ latestVersion }}</strong>
          </p>
          <p v-if="registryError" class="ocu-warn small">
            版本查询附注：{{ registryError }}
          </p>
          <p class="ocu-note small muted">
            升级只替换程序文件；你的配置、技能与 API Key（<code>~/.openclaw/</code>）不会被覆盖。
            升级后会自动运行 <code>openclaw doctor</code> 完成配置迁移，再重启网关即可。
          </p>
          <p v-if="upgradeError" class="ocu-error small">
            升级失败：{{ upgradeError }}。可在终端手动执行
            <code class="ocu-code">npm install -g openclaw@latest</code>
          </p>
          <pre v-if="upgradeLogTail" class="ocu-log-tail"><code>{{ upgradeLogTail }}</code></pre>
          <p v-if="!upgradeError" class="ocu-cli small">
            手动方式：<code class="ocu-code">npm install -g openclaw@latest</code>
          </p>
          <p class="ocu-doc small">
            <a
              href="https://docs.openclaw.ai/zh-CN/install/updating"
              target="_blank"
              rel="noopener noreferrer"
              class="ocu-link"
            >查看官方更新文档</a>
          </p>
          <div class="ocu-actions">
            <button
              v-if="platform === 'windows'"
              type="button"
              class="lc-btn lc-btn-primary lc-btn-sm"
              :disabled="upgradeBusy"
              @click="onWindowsScriptUpgrade"
            >
              {{ upgradeBusy ? "升级中，请稍候…" : "一键升级（Windows）" }}
            </button>
            <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" @click="dismissForThisRelease">
              稍后提醒
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ocu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.45);
}

.ocu-panel {
  width: min(420px, 100%);
  max-height: min(90vh, 520px);
  overflow: auto;
  padding: 1.25rem 1.35rem;
  border-radius: 10px;
  background: var(--lc-surface, #1e1e1e);
  color: var(--lc-text, #e8e8e8);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.ocu-title {
  margin: 0 0 0.65rem;
  font-size: 1.05rem;
  font-weight: 600;
}

.ocu-versions {
  margin: 0 0 0.75rem;
  line-height: 1.45;
}

.ocu-warn {
  margin: 0 0 0.65rem;
  color: #f0c674;
}

.ocu-note,
.ocu-cli,
.ocu-doc {
  margin: 0 0 0.55rem;
  line-height: 1.45;
}

.ocu-code {
  display: inline-block;
  margin-top: 0.2rem;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.25);
  font-size: 0.85em;
}

.ocu-link {
  color: var(--lc-accent, #6ea8fe);
  text-decoration: none;
}
.ocu-link:hover {
  text-decoration: underline;
}

.ocu-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

.ocu-done-icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  font-size: 1.25rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.65rem;
}

.ocu-restart-ok {
  color: #22c55e;
  margin: 0 0 0.35rem;
}

.ocu-error {
  color: #f87171;
  margin: 0 0 0.55rem;
  line-height: 1.5;
}

.ocu-log-tail {
  margin: 0 0 0.65rem;
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.26);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--lc-text, #e8e8e8);
  font-size: 0.82rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
