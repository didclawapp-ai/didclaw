<script setup lang="ts">
import { getLclawDesktopApi } from "@/lib/electron-bridge";
import { useLocalSettingsStore } from "@/stores/localSettings";
import { computed, onMounted, ref, watch } from "vue";

const WIZARD_DOC = "https://docs.openclaw.ai/start/wizard";
const ONBOARD_CMD = "openclaw onboard";

const SNOOZE_KEY = "lclaw_setup_wizard_snooze_until";
const SNOOZE_MS = 24 * 60 * 60 * 1000;

const localSettings = useLocalSettingsStore();

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

/** 已装 CLI，但尚未生成数据目录（最常见：只 npm -g 了，还没 onboard） */
const cliReadyNeedInit = computed(
  () => !loading.value && cliOk.value && !openclawDirExists.value,
);

const canRunEnsureInstall = computed(() => {
  if (typeof navigator === "undefined" || !/Win/i.test(navigator.userAgent)) {
    return false;
  }
  const api = getLclawDesktopApi();
  return Boolean(api?.runEnsureOpenclawWindowsInstall);
});

const leadText = computed(() => {
  if (cliReadyNeedInit.value) {
    return "已检测到 openclaw 命令行，但还没有用户数据目录。需要跑一次官方初始化（onboard）生成用户文件夹下的 .openclaw，之后才能连网关、配模型。";
  }
  return "未检测到本机 OpenClaw 数据目录（通常为用户文件夹下的 .openclaw）。请先安装官方助手并完成初始化，否则无法连接网关与对话。";
});

function readSnoozeExpired(): boolean {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) {
      return true;
    }
    const until = Number(raw);
    if (!Number.isFinite(until)) {
      return true;
    }
    return Date.now() >= until;
  } catch {
    return true;
  }
}

async function refreshStatus(): Promise<void> {
  const api = getLclawDesktopApi();
  if (!api?.getOpenClawSetupStatus) {
    loading.value = false;
    visible.value = false;
    return;
  }
  loading.value = true;
  loadError.value = null;
  try {
    const s = await api.getOpenClawSetupStatus();
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
    if (s.openclawDirExists) {
      visible.value = false;
      return;
    }
    visible.value = readSnoozeExpired();
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
    visible.value = false;
  } finally {
    loading.value = false;
  }
}

function onOpenSettings(): void {
  localSettings.open("gateway");
  visible.value = false;
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

function onSnooze(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    /* ignore */
  }
  visible.value = false;
}

async function copyOnboardCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText(ONBOARD_CMD);
  } catch {
    /* ignore */
  }
}

function openWizardDoc(): void {
  try {
    window.open(WIZARD_DOC, "_blank", "noopener,noreferrer");
  } catch {
    /* ignore */
  }
}

/** 执行打包内的 ensure-openclaw-windows.ps1（下载官方 install.ps1 + 可选非交互 onboard） */
async function runEnsureScript(skipOnboard: boolean): Promise<void> {
  const api = getLclawDesktopApi();
  if (!api?.runEnsureOpenclawWindowsInstall) {
    return;
  }
  installBusy.value = true;
  installLog.value = skipOnboard
    ? "正在执行：仅安装 CLI（-SkipOnboard）…\n"
    : "正在执行：安装 CLI + 非交互 onboard（-OnboardAuthChoice skip）…\n";
  try {
    const r = await api.runEnsureOpenclawWindowsInstall({ skipOnboard });
    installLog.value = r.log;
    if (r.ok) {
      await refreshStatus();
    } else if (r.error) {
      installLog.value += `\n[结果] ${r.error}（退出码 ${r.exitCode}）`;
    }
  } catch (e) {
    installLog.value += `\n${e instanceof Error ? e.message : String(e)}`;
  } finally {
    installBusy.value = false;
  }
}

onMounted(() => {
  void refreshStatus();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="first-run-root" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
      <div class="first-run-backdrop" />
      <div class="first-run-card">
        <h2 id="first-run-title" class="first-run-title">欢迎使用</h2>
        <p class="first-run-lead">
          {{ leadText }}
          <template v-if="!cliReadyNeedInit">
            目录一般为 <code>.openclaw</code>。
          </template>
        </p>

        <div v-if="cliReadyNeedInit" class="first-run-tip" role="note">
          <strong>建议下一步</strong>：在终端执行
          <code class="first-run-cmd">{{ ONBOARD_CMD }}</code>
          <span class="first-run-tip-actions">
            <button type="button" class="lc-btn lc-btn-ghost lc-btn-xs" @click="() => void copyOnboardCommand()">
              复制命令
            </button>
            <button type="button" class="lc-btn lc-btn-ghost lc-btn-xs" @click="openWizardDoc">官方说明</button>
          </span>
          <span class="first-run-tip-after">
            也可点下方「应用内运行初始化」自动执行脚本；或手动在终端运行后点「重新检测」。
          </span>
        </div>

        <div v-if="loading" class="first-run-muted">正在检测环境…</div>
        <p v-else-if="loadError" class="first-run-err">{{ loadError }}</p>
        <template v-else>
          <ul class="first-run-checks">
            <li :class="{ ok: openclawDirExists, bad: !openclawDirExists }">
              数据目录 .openclaw：{{ openclawDirExists ? "已存在" : "未找到" }}
            </li>
            <li
              :class="{
                ok: configState === 'ok',
                bad: configState === 'invalid',
                warn: configState === 'missing',
              }"
            >
              openclaw.json：{{
                configState === "ok" ? "正常" : configState === "missing" ? "缺失" : "异常"
              }}
              <span v-if="configError" class="first-run-detail">（{{ configError }}）</span>
            </li>
            <li :class="{ ok: cliOk, bad: !cliOk }">
              openclaw 命令行：{{ cliOk ? "已找到" : "未找到" }}
              <span v-if="cliPath" class="first-run-detail">{{ cliPath }}</span>
              <span v-if="cliError" class="first-run-detail">{{ cliError }}</span>
            </li>
          </ul>
        </template>

        <div
          v-if="canRunEnsureInstall && !loading && !loadError"
          class="first-run-install"
        >
          <p class="first-run-install-title">应用内一键安装（Windows）</p>
          <p class="first-run-install-hint">
            使用内置 <code>ensure-openclaw-windows.ps1</code>：下载官方 install.ps1，并可自动完成非交互
            onboard（默认跳过云端模型，稍后在龙虾里配置）。可能需要数分钟，请保持网络畅通。
          </p>
          <div class="first-run-install-btns">
            <button
              v-if="cliReadyNeedInit"
              type="button"
              class="lc-btn lc-btn-primary"
              :disabled="installBusy"
              @click="() => void runEnsureScript(false)"
            >
              应用内运行初始化（生成 .openclaw）
            </button>
            <template v-else>
              <button
                type="button"
                class="lc-btn lc-btn-primary"
                :disabled="installBusy"
                @click="() => void runEnsureScript(false)"
              >
                一键安装并初始化（推荐）
              </button>
              <button
                type="button"
                class="lc-btn lc-btn-ghost"
                :disabled="installBusy"
                @click="() => void runEnsureScript(true)"
              >
                仅安装命令行（不 onboard）
              </button>
            </template>
          </div>
          <pre v-if="installLog.trim()" class="first-run-install-log">{{ installLog }}</pre>
        </div>
        <p v-else-if="!loading && !loadError && !canRunEnsureInstall" class="first-run-platform-note">
          非 Windows 或未打包脚本时：请按
          <a :href="WIZARD_DOC" target="_blank" rel="noopener noreferrer">OpenClaw 官方文档</a>
          安装后，再打开本机设置连接网关。
        </p>

        <div class="first-run-actions">
          <button
            type="button"
            class="lc-btn lc-btn-primary"
            :disabled="loading || installBusy"
            @click="onOpenSettings"
          >
            打开本机设置（连助手）
          </button>
          <button
            type="button"
            class="lc-btn lc-btn-ghost"
            :disabled="loading || installBusy"
            @click="() => void refreshStatus()"
          >
            重新检测
          </button>
          <button
            type="button"
            class="lc-btn lc-btn-ghost"
            :disabled="loading || installBusy"
            @click="onSnooze"
          >
            稍后再说（24 小时内不提示）
          </button>
        </div>
        <p class="first-run-foot">
          <template v-if="cliReadyNeedInit">
            优先试「应用内运行初始化」；若失败可手动终端执行 onboard。完成后点「重新检测」。网关与 Token 可在本机设置核对。
          </template>
          <template v-else>
            可用上方脚本一键安装；模型与 API 仍建议在「本机设置」或后续向导中配置。未装 CLI 时也可只在设置里填写 openclaw 路径。
          </template>
        </p>
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
.first-run-checks {
  margin: 0 0 16px;
  padding-left: 1.1rem;
  font-size: 0.8rem;
  line-height: 1.65;
  color: var(--lc-text-muted);
}
.first-run-checks li.ok {
  color: var(--lc-success, #4ade80);
}
.first-run-checks li.bad {
  color: var(--lc-error, #f87171);
}
.first-run-checks li.warn {
  color: var(--lc-text-dim, #a1b0c0);
}
.first-run-detail {
  display: block;
  margin-top: 2px;
  font-size: 0.72rem;
  opacity: 0.92;
  word-break: break-all;
}
.first-run-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.first-run-foot {
  margin: 14px 0 0;
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--lc-text-dim);
}
.first-run-tip {
  margin: 0 0 14px;
  padding: 12px 12px 10px;
  border-radius: var(--lc-radius-sm, 8px);
  border: 1px solid var(--lc-border-strong, #3d4f63);
  background: var(--lc-bg-raised, #232d3a);
  font-size: 0.78rem;
  line-height: 1.55;
  color: var(--lc-text-muted, #8b9cb0);
}
.first-run-tip strong {
  display: block;
  margin-bottom: 6px;
  color: var(--lc-text, #e8eef4);
  font-size: 0.8rem;
}
.first-run-cmd {
  display: inline-block;
  margin: 4px 0 6px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--lc-bg, #0f1419);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.8rem;
  color: var(--lc-accent, #2dd4bf);
}
.first-run-tip-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.first-run-tip-after {
  display: block;
  font-size: 0.72rem;
  color: var(--lc-text-dim);
}
.first-run-install {
  margin: 0 0 14px;
  padding: 12px;
  border-radius: var(--lc-radius-sm, 8px);
  border: 1px dashed var(--lc-border-strong, #3d4f63);
  background: var(--lc-bg-raised, #232d3a);
}
.first-run-install-title {
  margin: 0 0 6px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--lc-text, #e8eef4);
}
.first-run-install-hint {
  margin: 0 0 10px;
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--lc-text-muted);
}
.first-run-install-hint code {
  font-size: 0.68rem;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--lc-bg, #0f1419);
}
.first-run-install-btns {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
.first-run-platform-note {
  margin: 0 0 12px;
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--lc-text-dim);
}
.first-run-platform-note a {
  color: var(--lc-accent, #2dd4bf);
}
</style>
