<script setup lang="ts">
import { getLclawDesktopApi } from "@/lib/electron-bridge";
import { useLocalSettingsStore } from "@/stores/localSettings";
import { onMounted, ref, watch } from "vue";

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
          未检测到本机 OpenClaw 数据目录（通常为用户文件夹下的 <code>.openclaw</code>）。请先安装官方助手并完成初始化，否则无法连接网关与对话。
        </p>

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

        <div class="first-run-actions">
          <button type="button" class="lc-btn lc-btn-primary" :disabled="loading" @click="onOpenSettings">
            打开本机设置（连助手）
          </button>
          <button type="button" class="lc-btn lc-btn-ghost" :disabled="loading" @click="() => void refreshStatus()">
            重新检测
          </button>
          <button type="button" class="lc-btn lc-btn-ghost" :disabled="loading" @click="onSnooze">
            稍后再说（24 小时内不提示）
          </button>
        </div>
        <p class="first-run-foot">
          完整安装引导将逐步接入「官方一键安装」与模型配置。当前可先在本机设置中填写 OpenClaw 路径并保存。
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
  max-width: 420px;
  width: 100%;
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
</style>
