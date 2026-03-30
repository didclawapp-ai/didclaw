<script setup lang="ts">
import {
  afterOpenClawModelConfigSaved,
  isFirstRunModelStepComplete,
  markFirstRunModelStepComplete,
  setModelConfigDeferred,
} from "@/composables/modelConfigDeferred";
import { scheduleDeferredGatewayConnect } from "@/composables/deferredGatewayConnect";
import { restartGatewayAfterControlUiMerge } from "@/composables/restartGatewayAfterControlUiMerge";
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { openExternalUrl } from "@/lib/open-external";
import { useChatStore } from "@/stores/chat";
import { useGatewayStore } from "@/stores/gateway";
import { useLocalSettingsStore } from "@/stores/localSettings";
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const WIZARD_DOC = "https://docs.openclaw.ai/start/wizard";
const OLLAMA_DEFAULT_PRIMARY = "ollama/qwen2.5:7b";

const { t } = useI18n();

const localSettings = useLocalSettingsStore();
const chat = useChatStore();
const gw = useGatewayStore();

type WizardPhase = "env" | "model";
const phase = ref<WizardPhase>("env");

const visible = ref(false);
const loading = ref(true);
const loadError = ref<string | null>(null);
const openclawDirExists = ref(false);
const configState = ref<"ok" | "missing" | "invalid">("missing");
const configError = ref<string | null>(null);
const cliOk = ref(false);
const cliPath = ref<string | null>(null);
const cliError = ref<string | null>(null);

const installBusy = ref(false);
const installLog = ref("");
/** 安装脚本已运行秒数（每秒 +1，仅作参考） */
const installElapsedSec = ref(0);
/** true = 脚本退出码 6：自动装 Node.js 失败，需用户手动安装 */
const nodeManualInstallNeeded = ref(false);

/** 与 `ensure-openclaw-windows.ps1` / Rust `didclaw-ensure-install-phase` 约定一致 */
const ENSURE_UI_LINE_RE = /^\[ensure-openclaw\] ui=(\S+)/;

type InstallStepId = "env" | "node" | "cli" | "onboard" | "finish";
type InstallStepStatus = "pending" | "active" | "done" | "error";

type InstallStepRow = {
  id: InstallStepId;
  label: string;
  status: InstallStepStatus;
  detail?: string;
};

function defaultInstallStepRows(): InstallStepRow[] {
  return [
    { id: "env", label: t("wizard.stepEnv"), status: "pending" },
    { id: "node", label: t("wizard.stepNode"), status: "pending" },
    { id: "cli", label: t("wizard.stepCli"), status: "pending" },
    { id: "onboard", label: t("wizard.stepOnboard"), status: "pending" },
    { id: "finish", label: t("wizard.stepFinish"), status: "pending" },
  ];
}

function openNodeJsDownload(): void {
  void openExternalUrl("https://nodejs.org/en/download");
}

const installStepRows = ref<InstallStepRow[]>(defaultInstallStepRows());

function installStepRow(id: InstallStepId): InstallStepRow | undefined {
  return installStepRows.value.find((r) => r.id === id);
}

function setInstallStep(
  id: InstallStepId,
  status: InstallStepStatus,
  detail?: string,
): void {
  const r = installStepRow(id);
  if (!r) {
    return;
  }
  r.status = status;
  if (detail !== undefined) {
    r.detail = detail;
  }
}

function resetInstallStepRows(): void {
  installStepRows.value = defaultInstallStepRows();
}

function markInstallStepErrorOnActive(): void {
  for (const r of installStepRows.value) {
    if (r.status === "active") {
      r.status = "error";
      return;
    }
  }
  const env = installStepRow("env");
  if (env?.status === "pending") {
    env.status = "error";
    env.detail = t("wizard.phaseEnvFailedToStart");
  }
}

/** Parse script `ui=…` and Rust-emitted `precheck_ok` phase keys. */
function ingestEnsureInstallUiKey(key: string): void {
  switch (key) {
    case "precheck_ok":
      setInstallStep("env", "active", t("wizard.phasePrecheck"));
      break;
    case "env_begin":
      setInstallStep("env", "active");
      break;
    case "env_path_ok":
      setInstallStep("env", "done");
      setInstallStep("node", "active", t("wizard.phaseEnvChecking"));
      break;
    case "node_ok":
      setInstallStep("node", "done", t("wizard.phaseNodeOk"));
      break;
    case "node_not_found":
      setInstallStep("node", "active", t("wizard.phaseNodeNotFound"));
      break;
    case "node_install_begin":
      setInstallStep("node", "active", t("wizard.phaseNodeInstallBegin"));
      break;
    case "node_install_winget":
      setInstallStep("node", "active", t("wizard.phaseNodeInstallWinget"));
      break;
    case "node_install_msi":
      setInstallStep("node", "active", t("wizard.phaseNodeInstallMsi"));
      break;
    case "node_required_manual":
      setInstallStep("node", "error", t("wizard.phaseNodeRequiredManual"));
      break;
    case "stage_cli_install_begin":
      setInstallStep("cli", "active", t("wizard.phaseCliBegin"));
      break;
    case "downloading_official_install_ps1":
      setInstallStep("cli", "active", t("wizard.phaseCliDownloading"));
      break;
    case "running_official_install_ps1_wait":
      setInstallStep("cli", "active", t("wizard.phaseCliRunning"));
      break;
    case "official_install_ps1_finished":
      setInstallStep("cli", "done");
      setInstallStep("node", "done", t("wizard.phaseReady"));
      break;
    case "openclaw_already_installed":
      setInstallStep("cli", "done", t("wizard.phaseCliAlreadyInstalled"));
      setInstallStep("onboard", "active", t("wizard.phaseOnboardWaiting"));
      break;
    case "onboard_prepare":
      setInstallStep("onboard", "active", t("wizard.phaseOnboardPrepare"));
      break;
    case "onboard_exec":
      setInstallStep("onboard", "active", t("wizard.phaseOnboardExec"));
      break;
    case "script_finished_ok":
      setInstallStep("onboard", "done");
      setInstallStep("finish", "done");
      break;
    case "skip_onboard_exit":
      setInstallStep("onboard", "done", t("wizard.phaseOnboardSkipped"));
      setInstallStep("finish", "done");
      break;
    default:
      break;
  }
}

function formatInstallElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const modelBusy = ref(false);
const modelError = ref<string | null>(null);

const canRunEnsureInstall = computed(() => {
  if (typeof navigator === "undefined" || !/Win/i.test(navigator.userAgent)) {
    return false;
  }
  const api = getDidClawDesktopApi();
  return Boolean(api?.runEnsureOpenclawWindowsInstall);
});

const dialogAriaLabel = computed(() =>
  phase.value === "model" ? t("wizard.ariaConfigModel") : t("wizard.ariaInstall"),
);

async function refreshStatus(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.getOpenClawSetupStatus) {
    loading.value = false;
    visible.value = false;
    return;
  }
  loading.value = true;
  loadError.value = null;
  modelError.value = null;
  try {
    const s = await api.getOpenClawSetupStatus();
    if (s.controlUiAllowedOriginsMerged) {
      await restartGatewayAfterControlUiMerge(gw);
    }
    openclawDirExists.value = s.openclawDirExists;
    configState.value = s.openclawConfigState;
    configError.value = s.openclawConfigError;
    if (s.openclawCli.ok) {
      cliOk.value = true;
      cliPath.value = s.openclawCli.path;
      cliError.value = null;
    } else {
      cliOk.value = false;
      cliPath.value = null;
      cliError.value = s.openclawCli.error;
    }

    if (!s.openclawDirExists) {
      phase.value = "env";
      visible.value = true;
      return;
    }

    if (isFirstRunModelStepComplete()) {
      visible.value = false;
      scheduleDeferredGatewayConnect(gw);
      return;
    }

    if (api.readOpenClawModelConfig) {
      try {
        const mc = await api.readOpenClawModelConfig();
        if (mc.ok) {
          const primary = mc.model?.primary;
          if (typeof primary === "string" && primary.trim().length > 0) {
            markFirstRunModelStepComplete();
            setModelConfigDeferred(false);
            visible.value = false;
            scheduleDeferredGatewayConnect(gw);
            return;
          }
        }
      } catch {
        /* 忽略，继续显示模型步 */
      }
    }

    phase.value = "model";
    visible.value = true;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
    visible.value = false;
  } finally {
    loading.value = false;
  }
}

/** 从本机设置返回后重新检测，便于装完助手仍无 .openclaw 时再次提示 */
watch(
  () => localSettings.visible,
  (now, prev) => {
    if (prev === true && now === false) {
      void refreshStatus();
    }
  },
);

/** 执行打包内的 ensure-openclaw-windows.ps1（下载官方 install.ps1 + 非交互 onboard） */
async function runEnsureInstallAndInit(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.runEnsureOpenclawWindowsInstall) {
    return;
  }
  installBusy.value = true;
  installElapsedSec.value = 0;
  nodeManualInstallNeeded.value = false;
  resetInstallStepRows();
  installLog.value = t("wizard.installStartMsg") + "\n";

  let streamReceived = false;
  let unlisten: UnlistenFn | undefined;
  let unlistenPhase: UnlistenFn | undefined;
  let tick: number | undefined;
  if (isTauri()) {
    try {
      unlistenPhase = await listen<{ key?: string; detail?: string }>(
        "didclaw-ensure-install-phase",
        (ev) => {
          const k = ev.payload?.key;
          if (typeof k === "string" && k.length > 0) {
            ingestEnsureInstallUiKey(k);
          }
          const d = ev.payload?.detail;
          const envR = installStepRow("env");
          if (typeof d === "string" && d.length > 0 && envR && envR.status === "active") {
            envR.detail = d;
          }
        },
      );
    } catch {
      /* 与日志监听一致 */
    }
    try {
      unlisten = await listen<{ stream?: string; line?: string }>(
        "didclaw-ensure-install-log",
        (ev) => {
          const line = ev.payload?.line;
          if (typeof line !== "string" || line.length === 0) {
            return;
          }
          streamReceived = true;
          const m = line.match(ENSURE_UI_LINE_RE);
          if (m?.[1]) {
            ingestEnsureInstallUiKey(m[1]);
          }
          const prefix = ev.payload?.stream === "stderr" ? "[stderr] " : "";
          installLog.value += `${prefix}${line}\n`;
        },
      );
    } catch {
      /* 监听失败时仍依赖 invoke 结束后的完整 log */
    }
  }
  tick = window.setInterval(() => {
    installElapsedSec.value += 1;
  }, 1000);

  try {
    const r = await api.runEnsureOpenclawWindowsInstall({ skipOnboard: false });
    if (!isTauri() || !streamReceived) {
      installLog.value = t("wizard.installStartMsg") + "\n" + (r.log ?? "");
      for (const line of (r.log ?? "").split("\n")) {
        const m = line.match(ENSURE_UI_LINE_RE);
        if (m?.[1]) {
          ingestEnsureInstallUiKey(m[1]);
        }
      }
    } else {
      const tail =
        typeof r.error === "string" && r.error.length > 0
          ? ` — ${r.error}`
          : "";
      installLog.value += "\n" + t("wizard.installExitLine", { code: r.exitCode, tail: r.ok ? "" : tail }) + "\n";
    }
    if (r.ok) {
      nodeManualInstallNeeded.value = false;
      setInstallStep("onboard", "done");
      setInstallStep("finish", "done");
      await refreshStatus();
    } else {
      markInstallStepErrorOnActive();
      if (r.exitCode === 6) {
        // Node.js 自动安装失败，需要用户手动安装
        nodeManualInstallNeeded.value = true;
        setInstallStep("node", "error", t("wizard.phaseNodeRequiredManual"));
      } else {
        nodeManualInstallNeeded.value = false;
        const logIsEmpty = !streamReceived && (r.log ?? "").replace("--- streamed ---", "").trim().length === 0;
        if (logIsEmpty) {
          installLog.value += "\n" + t("wizard.installNoOutputResult", { code: r.exitCode });
          installLog.value += "\n" + t("wizard.installNoOutputHint1");
          installLog.value += "\n" + t("wizard.installNoOutputHint2");
          installLog.value += "\n" + t("wizard.installNoOutputHint3");
          installLog.value += "\n" + t("wizard.installNoOutputSuggest");
        } else if (r.error && !streamReceived) {
          installLog.value += "\n" + t("wizard.installErrorResult", { error: r.error, code: r.exitCode });
        }
      }
    }
  } catch (e) {
    markInstallStepErrorOnActive();
    installLog.value += `\n${e instanceof Error ? e.message : String(e)}`;
  } finally {
    if (tick !== undefined) {
      clearInterval(tick);
    }
    unlisten?.();
    unlistenPhase?.();
    installBusy.value = false;
    installElapsedSec.value = 0;
  }
}

/** 一键写入本机 Ollama（OpenAI 兼容接口 + 默认 qwen2.5:7b） */
async function applyOllamaQuickSetup(): Promise<void> {
  const api = getDidClawDesktopApi();
  modelError.value = null;
  if (!api?.writeOpenClawProvidersPatch || !api?.writeOpenClawModelConfig) {
    modelError.value = t("settings.desktopOnly");
    return;
  }
  modelBusy.value = true;
  try {
    const pr = await api.writeOpenClawProvidersPatch({
      patch: {
        ollama: {
          baseUrl: "http://127.0.0.1:11434/v1",
          apiKey: "",
          models: { "qwen2.5:7b": {} },
          api: "openai-completions",
        },
      },
    });
    if (!pr.ok) {
      modelError.value = pr.error;
      return;
    }
    const mr = await api.writeOpenClawModelConfig({
      model: { primary: OLLAMA_DEFAULT_PRIMARY },
      models: {},
    });
    if (!mr.ok) {
      modelError.value = mr.error;
      return;
    }
    await chat.refreshOpenClawModelPicker();
    chat.flashOpenClawConfigHint();
    afterOpenClawModelConfigSaved();
    visible.value = false;
    gw.disconnect();
    scheduleDeferredGatewayConnect(gw);
  } catch (e) {
    modelError.value = e instanceof Error ? e.message : String(e);
  } finally {
    modelBusy.value = false;
  }
}

function onModelCloudPath(): void {
  localSettings.open("providers");
  visible.value = false;
}

function onModelSkipLater(): void {
  if (!window.confirm(t("wizard.skipModelConfirm"))) {
    return;
  }
  setModelConfigDeferred(true);
  markFirstRunModelStepComplete();
  visible.value = false;
  scheduleDeferredGatewayConnect(gw);
}

function onRecheckFirstRunEvent(): void {
  void refreshStatus();
}

onMounted(() => {
  void refreshStatus();
  window.addEventListener("didclaw-first-run-recheck", onRecheckFirstRunEvent);
});

onUnmounted(() => {
  window.removeEventListener("didclaw-first-run-recheck", onRecheckFirstRunEvent);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="first-run-root"
      role="dialog"
      aria-modal="true"
      :aria-label="dialogAriaLabel"
    >
      <div class="first-run-backdrop" />
      <div class="first-run-card">
        <template v-if="phase === 'env'">
          <h2 id="first-run-title" class="first-run-title">{{ t('wizard.title') }}</h2>
          <div v-if="loading" class="first-run-muted">{{ t('wizard.loadingEnv') }}</div>
          <p v-else-if="loadError" class="first-run-err">{{ loadError }}</p>
          <template v-else>
            <p class="first-run-lead">{{ t('wizard.envLead') }}</p>
            <p v-if="!canRunEnsureInstall" class="first-run-platform-note">
              {{ t('wizard.platformNotePrefix') }}
              <a :href="WIZARD_DOC" target="_blank" rel="noopener noreferrer">{{ t('wizard.platformNoteLink') }}</a>
              。
            </p>
            <div
              v-if="canRunEnsureInstall && installBusy"
              class="first-run-install-progress"
              role="status"
              aria-live="polite"
            >
              <ol class="first-run-install-steps" :aria-label="t('wizard.installProgressLabel')">
                <li
                  v-for="s in installStepRows"
                  :key="s.id"
                  class="first-run-install-step"
                  :data-status="s.status"
                >
                  <span class="first-run-install-step-body">
                    <span class="first-run-install-step-label">{{ s.label }}</span>
                    <span v-if="s.detail" class="first-run-install-step-detail">{{ s.detail }}</span>
                  </span>
                </li>
              </ol>
              <p class="first-run-install-elapsed-note">
                {{ t('wizard.installElapsed', { time: formatInstallElapsed(installElapsedSec) }) }}
              </p>
            </div>
            <!-- Node.js manual install guide (exit code 6) -->
            <div v-if="nodeManualInstallNeeded && !installBusy" class="node-manual-panel">
              <div class="node-manual-icon" aria-hidden="true">📦</div>
              <div class="node-manual-body">
                <p class="node-manual-title">{{ t('wizard.nodeManualTitle') }}</p>
                <p class="node-manual-desc">{{ t('wizard.nodeManualDesc') }}</p>
                <div class="node-manual-actions">
                  <button
                    type="button"
                    class="lc-btn lc-btn-sm"
                    @click="openNodeJsDownload"
                  >
                    {{ t('wizard.nodeDownloadBtn') }}
                  </button>
                  <span class="node-manual-hint">{{ t('wizard.nodeManualHint') }}</span>
                </div>
              </div>
            </div>

            <pre
              v-if="canRunEnsureInstall && installLog.trim()"
              class="first-run-install-log"
              :class="{ 'first-run-install-log--busy': installBusy }"
            >{{ installLog }}</pre>
            <div class="first-run-actions first-run-env-actions">
              <button
                v-if="canRunEnsureInstall"
                type="button"
                class="lc-btn lc-btn-primary"
                :disabled="installBusy"
                @click="() => void runEnsureInstallAndInit()"
              >
                {{ t('wizard.installBtn') }}
              </button>
              <button
                type="button"
                class="lc-btn lc-btn-ghost"
                :disabled="loading || installBusy"
                @click="() => void refreshStatus()"
              >
                {{ t('wizard.recheckBtn') }}
              </button>
            </div>
          </template>
        </template>

        <template v-else-if="phase === 'model'">
          <h2 id="first-run-model-title" class="first-run-title">{{ t('wizard.modelTitle') }}</h2>
          <div v-if="loading" class="first-run-muted">{{ t('wizard.loadingModel') }}</div>
          <p v-else-if="loadError" class="first-run-err">{{ loadError }}</p>
          <template v-else>
            <p class="first-run-lead first-run-lead-model">{{ t('wizard.modelLead') }}</p>
            <div class="model-cards">
              <button
                type="button"
                class="model-card model-card-local"
                :disabled="modelBusy"
                @click="() => void applyOllamaQuickSetup()"
              >
                <span class="model-card-num" aria-hidden="true">1</span>
                <div class="model-card-main">
                  <span class="model-card-tag">{{ t('wizard.tagLocalAi') }}</span>
                  <strong class="model-card-head">Ollama</strong>
                  <p class="model-card-desc">
                    <code>127.0.0.1:11434</code>
                    <span class="model-card-desc-sep">·</span>
                    <code>qwen2.5:7b</code>
                  </p>
                </div>
              </button>
              <button
                type="button"
                class="model-card model-card-cloud"
                :disabled="modelBusy"
                @click="onModelCloudPath"
              >
                <span class="model-card-num" aria-hidden="true">2</span>
                <div class="model-card-main">
                  <span class="model-card-tag">{{ t('wizard.tagCloudAi') }}</span>
                  <strong class="model-card-head">{{ t('wizard.cloudApiKey') }}</strong>
                  <p class="model-card-desc">{{ t('wizard.cloudDesc') }}</p>
                </div>
              </button>
              <button
                type="button"
                class="model-card model-card-later"
                :disabled="modelBusy"
                @click="onModelSkipLater"
              >
                <span class="model-card-num model-card-num-muted" aria-hidden="true">3</span>
                <div class="model-card-main">
                  <span class="model-card-tag model-card-tag-muted">{{ t('wizard.tagLater') }}</span>
                  <strong class="model-card-head">{{ t('wizard.skipModel') }}</strong>
                  <p class="model-card-desc">{{ t('wizard.laterDesc') }}</p>
                </div>
              </button>
            </div>
            <p v-if="modelError" class="first-run-err">{{ modelError }}</p>
            <div class="first-run-actions first-run-model-actions">
              <button
                type="button"
                class="lc-btn lc-btn-ghost"
                :disabled="loading || modelBusy"
                @click="() => void refreshStatus()"
              >
                {{ t('wizard.recheckBtn') }}
              </button>
            </div>
          </template>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.first-run-root {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
}
.first-run-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
}
.first-run-card {
  position: relative;
  max-width: 460px;
  width: 100%;
  max-height: min(92vh, 720px);
  overflow-y: auto;
  padding: 22px 20px 18px;
  border-radius: var(--lc-radius-md, 12px);
  border: 1px solid var(--lc-border, #2d3a4a);
  background: var(--lc-bg-elevated, #1a222c);
  color: var(--lc-text, #e8eef4);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
}
.first-run-title {
  margin: 0 0 10px;
  font-size: 1.1rem;
  font-weight: 600;
}
.first-run-lead {
  margin: 0 0 14px;
  font-size: 0.85rem;
  line-height: 1.55;
  color: var(--lc-text-muted, #8b9cb0);
}
.first-run-lead code {
  font-size: 0.8em;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--lc-bg-raised, #232d3a);
}
.first-run-lead-model {
  color: var(--lc-text, #e8eef4);
  font-size: 0.8rem;
  line-height: 1.6;
}
.first-run-muted {
  font-size: 0.85rem;
  color: var(--lc-text-muted);
  margin-bottom: 12px;
}
.first-run-err {
  font-size: 0.85rem;
  color: var(--lc-error, #f87171);
  margin: 0 0 12px;
}
.first-run-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.first-run-env-actions {
  margin-top: 14px;
}
.first-run-install-progress {
  margin: 12px 0 0;
  padding: 10px 10px 8px;
  border-radius: 6px;
  background: #0d1117;
  border: 1px solid var(--lc-border);
}
.first-run-install-steps {
  margin: 0;
  padding: 0 0 0 1.35rem;
  list-style: decimal;
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--lc-text-muted, #8b9cb0);
}
.first-run-install-step {
  margin: 0 0 6px;
  padding-left: 2px;
}
.first-run-install-step[data-status="done"] {
  color: #3fb950;
}
.first-run-install-step[data-status="active"] {
  color: #9ecbff;
}
.first-run-install-step[data-status="error"] {
  color: var(--lc-error, #f87171);
}
.first-run-install-step-label {
  font-weight: 600;
  color: inherit;
}
.first-run-install-step-detail {
  display: block;
  margin-top: 2px;
  font-weight: 400;
  font-size: 0.65rem;
  opacity: 0.92;
}
.first-run-install-elapsed-note {
  margin: 8px 0 0;
  font-size: 0.65rem;
  line-height: 1.45;
  color: var(--lc-text-muted, #8b9cb0);
  font-family: ui-monospace, Consolas, monospace;
}
.first-run-install-log {
  margin: 10px 0 0;
  max-height: 160px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 6px;
  background: #0d1117;
  border: 1px solid var(--lc-border);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.65rem;
  line-height: 1.45;
  color: #9ecbff;
  white-space: pre-wrap;
  word-break: break-word;
}
.first-run-install-log--busy {
  max-height: min(220px, 32vh);
}
.node-manual-panel {
  display: flex;
  gap: 12px;
  margin: 12px 0 0;
  padding: 14px 14px 14px 12px;
  border-radius: var(--lc-radius-sm, 8px);
  border: 1px solid rgba(217, 119, 6, 0.35);
  background: rgba(217, 119, 6, 0.08);
}
.node-manual-icon {
  font-size: 1.4rem;
  line-height: 1;
  flex-shrink: 0;
  margin-top: 1px;
}
.node-manual-body {
  flex: 1;
  min-width: 0;
}
.node-manual-title {
  margin: 0 0 6px;
  font-size: 0.82rem;
  font-weight: 600;
  color: #92400e;
}
.node-manual-desc {
  margin: 0 0 10px;
  font-size: 0.78rem;
  line-height: 1.5;
  color: #78350f;
}
.node-manual-desc strong {
  font-weight: 600;
}
.node-manual-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.node-manual-hint {
  font-size: 0.7rem;
  color: #92400e;
  opacity: 0.8;
}
.first-run-platform-note {
  margin: 0 0 12px;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--lc-text-muted);
}
.first-run-platform-note a {
  color: var(--lc-accent, #2dd4bf);
}
.model-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 0 16px;
}
.model-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  width: 100%;
  text-align: left;
  padding: 16px 14px;
  border-radius: 10px;
  border: 2px solid var(--lc-border-strong, #3d4f63);
  background: var(--lc-bg-raised, #232d3a);
  color: inherit;
  font: inherit;
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.22);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}
.model-card-local {
  border-color: rgba(45, 212, 191, 0.5);
  background: linear-gradient(
    145deg,
    rgba(45, 212, 191, 0.1) 0%,
    var(--lc-bg-raised, #232d3a) 52%
  );
}
.model-card-cloud {
  border-color: rgba(88, 166, 255, 0.5);
  background: linear-gradient(
    145deg,
    rgba(88, 166, 255, 0.1) 0%,
    var(--lc-bg-raised, #232d3a) 52%
  );
}
.model-card-later {
  border-style: dashed;
  border-color: var(--lc-border-strong, #3d4f63);
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.15);
}
.model-card:hover:not(:disabled) {
  border-color: var(--lc-accent, #2dd4bf);
  box-shadow: 0 6px 22px rgba(45, 212, 191, 0.14);
  transform: translateY(-2px);
}
.model-card-cloud:hover:not(:disabled) {
  border-color: #58a6ff;
  box-shadow: 0 6px 22px rgba(88, 166, 255, 0.14);
}
.model-card-later:hover:not(:disabled) {
  border-color: var(--lc-text-muted, #8b9cb0);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}
.model-card:disabled {
  opacity: 0.55;
  cursor: wait;
  transform: none;
}
.model-card-num {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1rem;
  line-height: 1;
  background: var(--lc-accent, #2dd4bf);
  color: #0a0e12;
}
.model-card-cloud .model-card-num {
  background: #58a6ff;
  color: #0a0e12;
}
.model-card-num-muted {
  background: transparent;
  border: 2px solid var(--lc-border-strong, #3d4f63);
  color: var(--lc-text-muted, #8b9cb0);
}
.model-card-main {
  flex: 1;
  min-width: 0;
}
.model-card-tag {
  display: block;
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lc-accent, #2dd4bf);
  margin-bottom: 6px;
}
.model-card-cloud .model-card-tag {
  color: #79b8ff;
}
.model-card-tag-muted {
  color: var(--lc-text-dim, #a1b0c0);
}
.model-card-head {
  display: block;
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 6px;
  color: var(--lc-text, #e8eef4);
}
.model-card-desc {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--lc-text-muted, #8b9cb0);
}
.model-card-desc code {
  font-size: 0.72rem;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--lc-bg, #0f1419);
  color: #9ecbff;
}
.model-card-desc-sep {
  margin: 0 0.35em;
  opacity: 0.55;
}
.first-run-model-actions {
  margin-top: 2px;
}
</style>
