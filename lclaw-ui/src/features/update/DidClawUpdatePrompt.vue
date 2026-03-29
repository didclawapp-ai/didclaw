<script setup lang="ts">
import { didclawKvReadSync, didclawKvWriteSync } from "@/lib/didclaw-kv";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import { onMounted, onUnmounted, ref } from "vue";

const DISMISS_KEY = "didclaw.appUpdate.dismissedVersion";
/** Delay before first auto-check (ms) */
const AUTO_CHECK_DELAY_MS = 30_000;

const open = ref(false);
const checking = ref(false);
const currentVersion = ref("");
const latestVersion = ref("");
const notes = ref<string | null>(null);
const downloadUrl = ref<string | null>(null);
const checkError = ref<string | null>(null);
const noEndpoint = ref(false);

const installBusy = ref(false);
const installError = ref<string | null>(null);
const installerLaunched = ref(false);

function getEndpoint(): string {
  return (import.meta.env.VITE_DIDCLAW_UPDATE_ENDPOINT ?? "").trim();
}

function emitResult(updateAvailable: boolean): void {
  window.dispatchEvent(new CustomEvent("didclaw-check-app-update-result", { detail: { updateAvailable } }));
}

async function runCheck(silent = true): Promise<void> {
  if (!isDidClawElectron()) { emitResult(false); return; }
  const api = getDidClawDesktopApi();
  if (!api?.checkDidClawUpdate) { emitResult(false); return; }

  checking.value = true;
  checkError.value = null;
  noEndpoint.value = false;
  try {
    const res = await api.checkDidClawUpdate({ endpoint: getEndpoint() || undefined });
    if (!res || res.ok === false) {
      if (!silent) checkError.value = ("error" in res ? res.error : null) ?? "检查失败";
      emitResult(false);
      return;
    }
    if (res.noEndpoint) {
      noEndpoint.value = true;
      if (!silent) checkError.value = "未配置更新地址（VITE_DIDCLAW_UPDATE_ENDPOINT）";
      emitResult(false);
      return;
    }
    if (!res.updateAvailable || !res.latestVersion?.trim()) {
      emitResult(false);
      return;
    }

    const lv = res.latestVersion.trim();
    if (silent) {
      try {
        if (didclawKvReadSync(DISMISS_KEY) === lv) { emitResult(false); return; }
      } catch { /* ignore */ }
    }

    currentVersion.value = res.currentVersion?.trim() || "（未知）";
    latestVersion.value = lv;
    notes.value = typeof res.notes === "string" && res.notes.trim() ? res.notes.trim() : null;
    downloadUrl.value = typeof res.downloadUrl === "string" ? res.downloadUrl : null;
    checkError.value = null;
    installError.value = null;
    installerLaunched.value = false;
    installBusy.value = false;
    open.value = true;
    emitResult(true);
  } catch (e) {
    if (!silent) checkError.value = e instanceof Error ? e.message : "检查更新时出错";
    emitResult(false);
  } finally {
    checking.value = false;
  }
}

function dismiss(): void {
  const lv = latestVersion.value.trim();
  if (lv) {
    try { didclawKvWriteSync(DISMISS_KEY, lv); } catch { /* ignore */ }
  }
  open.value = false;
  installError.value = null;
  installerLaunched.value = false;
}

async function onInstall(): Promise<void> {
  if (!downloadUrl.value) {
    window.open("https://didclaw.com", "_blank", "noopener");
    return;
  }
  const api = getDidClawDesktopApi();
  if (!api?.installDidClawUpdate) return;

  installBusy.value = true;
  installError.value = null;
  try {
    const res = await api.installDidClawUpdate({ downloadUrl: downloadUrl.value });
    if (!res || res.ok === false) {
      installError.value = ("error" in res ? res.error : null) ?? "启动安装程序失败";
      return;
    }
    installerLaunched.value = true;
  } catch (e) {
    installError.value = e instanceof Error ? e.message : "安装过程中出错";
  } finally {
    installBusy.value = false;
  }
}

function onManualCheck(): void {
  void runCheck(false);
}

onMounted(() => {
  window.addEventListener("didclaw-check-app-update", onManualCheck);
  if (!isDidClawElectron()) return;
  window.setTimeout(() => { void runCheck(true); }, AUTO_CHECK_DELAY_MS);
});

onUnmounted(() => {
  window.removeEventListener("didclaw-check-app-update", onManualCheck);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dcu-backdrop"
      role="presentation"
      @click.self="dismiss"
    >
      <div
        class="dcu-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dcu-title"
        @click.stop
      >
        <!-- Installer launched -->
        <template v-if="installerLaunched">
          <div class="dcu-done-icon" aria-hidden="true">↗</div>
          <h2 id="dcu-title" class="dcu-title">安装程序已启动</h2>
          <p class="dcu-note small muted">
            安装程序正在运行，请按照向导完成安装。安装完成后重新打开 DidClaw 即可使用新版本。
          </p>
          <div class="dcu-actions">
            <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" @click="dismiss">关闭</button>
          </div>
        </template>

        <!-- Update available -->
        <template v-else>
          <h2 id="dcu-title" class="dcu-title">发现 DidClaw 新版本</h2>
          <p class="dcu-versions">
            当前：<strong>{{ currentVersion }}</strong>
            &nbsp;·&nbsp;
            最新：<strong>{{ latestVersion }}</strong>
          </p>
          <div v-if="notes" class="dcu-notes">
            <p class="dcu-notes-label small muted">更新内容</p>
            <pre class="dcu-notes-body">{{ notes }}</pre>
          </div>
          <p v-if="installError" class="dcu-error small">{{ installError }}</p>
          <p v-if="!downloadUrl && !installError" class="dcu-note small muted">
            该平台暂无自动安装包，请手动前往官网下载最新版本。
          </p>
          <div class="dcu-actions">
            <button
              v-if="downloadUrl"
              type="button"
              class="lc-btn lc-btn-primary lc-btn-sm"
              :disabled="installBusy"
              @click="onInstall"
            >
              <span v-if="installBusy" class="dcu-spinner" aria-hidden="true" />
              {{ installBusy ? "下载中，请稍候…" : "下载并安装" }}
            </button>
            <button
              v-else
              type="button"
              class="lc-btn lc-btn-primary lc-btn-sm"
              @click="onInstall"
            >
              前往官网下载
            </button>
            <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" @click="dismiss">
              稍后提醒
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dcu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.45);
}

.dcu-panel {
  width: min(420px, 100%);
  max-height: min(90vh, 560px);
  overflow: auto;
  padding: 1.35rem 1.5rem;
  border-radius: 10px;
  background: var(--lc-surface, #1e1e1e);
  color: var(--lc-text, #e8e8e8);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.dcu-title {
  margin: 0 0 0.7rem;
  font-size: 1.05rem;
  font-weight: 600;
}

.dcu-versions {
  margin: 0 0 0.8rem;
  line-height: 1.5;
}

.dcu-notes {
  margin: 0 0 0.8rem;
  padding: 0.65rem 0.75rem;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.07);
}

.dcu-notes-label {
  margin: 0 0 0.35rem;
}

.dcu-notes-body {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--lc-text-muted, #aaa);
  font-family: inherit;
}

.dcu-note {
  margin: 0 0 0.55rem;
  line-height: 1.5;
}

.dcu-error {
  color: #f87171;
  margin: 0 0 0.55rem;
  line-height: 1.5;
}

.dcu-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

.dcu-done-icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: rgba(99, 179, 237, 0.15);
  color: #63b3ed;
  font-size: 1.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.65rem;
}

.dcu-spinner {
  display: inline-block;
  width: 0.85em;
  height: 0.85em;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: dcu-spin 0.7s linear infinite;
  margin-right: 0.35em;
  vertical-align: -0.1em;
}

@keyframes dcu-spin {
  to { transform: rotate(360deg); }
}

.small { font-size: 0.88rem; }
.muted { color: var(--lc-text-muted, #999); }
</style>
