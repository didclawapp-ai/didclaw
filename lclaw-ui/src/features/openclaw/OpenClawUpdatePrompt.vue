<script setup lang="ts">
import { didclawKvReadSync, didclawKvWriteSync } from "@/lib/didclaw-kv";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import { onMounted, ref } from "vue";

/** 用户点「稍后」后，对该 npm 版本不再提示，直至出现更新的 latest */
const DISMISS_KEY = "didclaw.openclawUpdate.dismissedLatest";

const open = ref(false);
const currentVersion = ref("");
const latestVersion = ref("");
const registryError = ref<string | null>(null);
const platform = ref("");
const upgradeBusy = ref(false);

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
}

async function onWindowsScriptUpgrade(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.runEnsureOpenclawWindowsInstall) {
    window.alert("当前环境无法调用内置升级脚本。");
    return;
  }
  upgradeBusy.value = true;
  try {
    const res = await api.runEnsureOpenclawWindowsInstall({ skipOnboard: true });
    if (res.ok) {
      dismissForThisRelease();
      window.alert(
        "升级脚本已执行完成。请重启 OpenClaw 网关（或系统内的 OpenClaw 服务）后再继续使用。",
      );
    } else {
      const err =
        typeof res.error === "string" && res.error.trim()
          ? res.error.trim()
          : `退出码 ${res.exitCode}`;
      window.alert(
        `升级未成功：${err}。可在终端查看 npm 输出，或参阅官方文档；本机配置与技能一般在用户目录 .openclaw 下，通常不会被覆盖。`,
      );
    }
  } finally {
    upgradeBusy.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ocu-backdrop" role="presentation" @click.self="dismissForThisRelease">
      <div
        class="ocu-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ocu-title"
        @click.stop
      >
        <h2 id="ocu-title" class="ocu-title">发现 OpenClaw 新版本</h2>
        <p class="ocu-versions">
          当前：<strong>{{ currentVersion }}</strong>
          · npm 最新：<strong>{{ latestVersion }}</strong>
        </p>
        <p v-if="registryError" class="ocu-warn small">
          版本查询附注：{{ registryError }}
        </p>
        <p class="ocu-note small muted">
          官方 CLI 升级一般只替换全局/服务中的 <code>openclaw</code> 程序；用户目录下的
          <code>.openclaw</code>（含 <code>openclaw.json</code>、技能、各厂商 API Key 等）通常保留。重大版本仍建议先自行备份该目录。
        </p>
        <p class="ocu-cli small">
          通用方式（需已安装 Node/npm）：在终端执行
          <code class="ocu-code">npm install -g openclaw@latest</code>
        </p>
        <p class="ocu-doc small">
          <a
            href="https://docs.openclaw.ai"
            target="_blank"
            rel="noopener noreferrer"
            class="ocu-link"
          >OpenClaw 官方文档</a>
        </p>
        <div class="ocu-actions">
          <button
            v-if="platform === 'windows'"
            type="button"
            class="lc-btn lc-btn-primary lc-btn-sm"
            :disabled="upgradeBusy"
            @click="onWindowsScriptUpgrade"
          >
            {{ upgradeBusy ? "执行中…" : "使用内置脚本升级（Windows）" }}
          </button>
          <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" @click="dismissForThisRelease">
            稍后提醒
          </button>
        </div>
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
</style>
