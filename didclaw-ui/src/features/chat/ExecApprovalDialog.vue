<script setup lang="ts">
import { GatewayRequestError } from "@/features/gateway/gateway-types";
import { type ApprovalDecision, useApprovalStore } from "@/stores/approval";
import { useGatewayStore } from "@/stores/gateway";
import { storeToRefs } from "pinia";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const approvalStore = useApprovalStore();
const gwStore = useGatewayStore();
const { pending, recentNotice } = storeToRefs(approvalStore);

/** 当前展示的审批请求（队列头部） */
const current = computed(() => pending.value[0] ?? null);

const busy = ref(false);
const resolveError = ref<string | null>(null);

const resolveErrorIsExpired = computed(() =>
  resolveError.value ? /unknown or expired approval id/i.test(resolveError.value) : false,
);

const displayApprovalId = computed(() => current.value?.approvalId.trim() ?? "");
const nowMs = ref(Date.now());

let nowTimer: ReturnType<typeof setInterval> | null = null;

function scheduleBackendRepairRefresh(delayMs: number): void {
  const schedule = (gwStore as unknown as {
    scheduleRefreshPendingBackendPairingRepair?: (ms?: number) => void;
  }).scheduleRefreshPendingBackendPairingRepair;
  if (typeof schedule === "function") {
    schedule(delayMs);
  }
}

onMounted(() => {
  nowTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer);
});

const showShellWrapperHint = computed(() => {
  const req = current.value;
  if (!req) return false;
  const resolved = String(req.resolvedPath ?? "").toLowerCase();
  if (resolved.endsWith("\\cmd.exe") || resolved.endsWith("\\powershell.exe") || resolved.endsWith("\\pwsh.exe")) {
    return true;
  }
  const cmd = displayCommand(req).trim();
  return /^(cmd(?:\.exe)?\s+\/[cCkKrRsS]\b|powershell(?:\.exe)?\b|pwsh(?:\.exe)?\b|Get-[A-Za-z])/i.test(cmd);
});

/** Resolve the most human-readable command string from the approval request */
function displayCommand(req: (typeof pending.value)[0]): string {
  if (!req) return "";
  const plan = req.systemRunPlan;
  // prefer preview/text fields from systemRunPlan (most readable)
  if (plan?.commandPreview) return plan.commandPreview;
  if (plan?.commandText) return plan.commandText;
  if (plan?.argv?.length) return plan.argv.join(" ");
  if (plan?.rawCommand) return plan.rawCommand;
  // gateway `request.commandPreview` / `request.command` (flattened on store)
  if (req.commandPreview) return req.commandPreview;
  if (req.command) return req.command;
  if (req.commandArgv?.length) return req.commandArgv.join(" ");
  return "";
}

function approvalFingerprint(req: (typeof pending.value)[0]): string {
  if (!req) return "";
  return [
    req.host ?? "",
    req.resolvedPath ?? "",
    displayCommand(req),
    req.systemRunPlan?.cwd ?? req.cwd ?? "",
    req.agentId ?? "",
  ].join("::");
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function resolve(decision: ApprovalDecision): Promise<void> {
  const req = current.value;
  if (!req || busy.value) return;
  busy.value = true;
  resolveError.value = null;
  const id = req.approvalId.trim();
  try {
    await gwStore.client?.request("exec.approval.resolve", {
      id,
      decision,
    });
    approvalStore.setRecentNotice(
      decision === "deny" ? t("approval.deniedNotice") : t("approval.submittedWaiting"),
    );
    scheduleBackendRepairRefresh(250);
    scheduleBackendRepairRefresh(1200);
    scheduleBackendRepairRefresh(3000);
    approvalStore.removePending(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    resolveError.value = msg;
    const expired =
      /unknown or expired approval id/i.test(msg) ||
      (e instanceof GatewayRequestError && /unknown or expired approval id/i.test(e.message));
    if (expired) {
      approvalStore.removePending(id);
    }
  } finally {
    busy.value = false;
  }
}

const expiresInText = computed(() => {
  const expiresAt = current.value?.expiresAtMs;
  if (!expiresAt) return "";
  return formatRemaining(expiresAt - nowMs.value);
});

const similarPendingCount = computed(() => {
  const req = current.value;
  if (!req) return 0;
  const target = approvalFingerprint(req);
  return pending.value.filter((item) => item.approvalId !== req.approvalId && approvalFingerprint(item) === target).length;
});

const resolveStateText = computed(() => (busy.value ? t("approval.submitting") : ""));
</script>

<template>
  <Teleport to="body">
    <Transition name="appr-fade">
      <div v-if="recentNotice" class="appr-toast" role="status">{{ recentNotice }}</div>
    </Transition>
    <Transition name="appr-fade">
      <div v-if="current" class="appr-backdrop">
        <div class="appr-dialog" role="dialog" :aria-label="t('approval.title')">
          <!-- 标题 -->
          <div class="appr-header">
            <span class="appr-icon" aria-hidden="true">⚠</span>
            <span class="appr-title">{{ t('approval.title') }}</span>
            <span v-if="pending.length > 1" class="appr-queue">+{{ pending.length - 1 }}</span>
          </div>

          <!-- 命令详情 -->
          <div class="appr-body">
            <div v-if="displayApprovalId" class="appr-row">
              <span class="appr-label">{{ t('approval.id') }}</span>
              <code class="appr-code appr-code--muted">{{ displayApprovalId }}</code>
            </div>
            <div v-if="current.host" class="appr-row">
              <span class="appr-label">{{ t('approval.host') }}</span>
              <span class="appr-val">{{ current.host }}</span>
            </div>
            <div v-if="current.sessionLabel || current.sessionKey" class="appr-row">
              <span class="appr-label">{{ t('approval.session') }}</span>
              <span class="appr-val">{{ current.sessionLabel || current.sessionKey }}</span>
            </div>
            <div v-if="current.resolvedPath" class="appr-row">
              <span class="appr-label">{{ t('approval.resolvedPath') }}</span>
              <code class="appr-code appr-code--muted">{{ current.resolvedPath }}</code>
            </div>
            <div class="appr-row">
              <span class="appr-label">{{ t('approval.command') }}</span>
              <code class="appr-code">{{ displayCommand(current) || t('approval.unknownCmd') }}</code>
            </div>
            <div v-if="current.systemRunPlan?.cwd || current.cwd" class="appr-row">
              <span class="appr-label">{{ t('approval.cwd') }}</span>
              <code class="appr-code appr-code--muted">{{ current.systemRunPlan?.cwd || current.cwd }}</code>
            </div>
            <div v-if="current.agentId" class="appr-row">
              <span class="appr-label">{{ t('approval.agent') }}</span>
              <span class="appr-val">{{ current.agentId }}</span>
            </div>
            <div v-if="current.security" class="appr-row">
              <span class="appr-label">{{ t('approval.security') }}</span>
              <span class="appr-val">{{ current.security }}</span>
            </div>
            <div v-if="current.ask" class="appr-row">
              <span class="appr-label">{{ t('approval.ask') }}</span>
              <span class="appr-val">{{ current.ask }}</span>
            </div>
            <div v-if="expiresInText" class="appr-row">
              <span class="appr-label">{{ t('approval.expiresIn') }}</span>
              <span class="appr-val">{{ expiresInText }}</span>
            </div>
            <p v-if="similarPendingCount > 0" class="appr-hint">
              {{ t("approval.similarRetriesHint", { count: similarPendingCount }) }}
            </p>
            <p v-if="showShellWrapperHint" class="appr-hint">
              {{ t('approval.shellWrapperHint') }}
            </p>
          </div>

          <!-- 错误提示 -->
          <p v-if="resolveError" class="appr-error" role="alert">
            <template v-if="resolveErrorIsExpired">{{ t('approval.expiredHint') }}</template>
            <template v-else>{{ resolveError }}</template>
          </p>
          <p v-else-if="resolveStateText" class="appr-info" role="status">{{ resolveStateText }}</p>

          <!-- 操作按钮 -->
          <div class="appr-actions">
            <button
              type="button"
              class="appr-btn appr-btn--deny"
              :disabled="busy"
              @click="resolve('deny')"
            >
              {{ t('approval.deny') }}
            </button>
            <button
              type="button"
              class="appr-btn appr-btn--once"
              :disabled="busy"
              @click="resolve('allow-once')"
            >
              {{ t('approval.allowOnce') }}
            </button>
            <button
              type="button"
              class="appr-btn appr-btn--always"
              :disabled="busy"
              @click="resolve('allow-always')"
            >
              {{ t('approval.allowAlways') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.appr-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10070;
  /* 无遮罩：用户仍可看到后面内容，但弹窗置于最前 */
  pointer-events: none;
}

.appr-dialog {
  pointer-events: auto;
  background: var(--lc-surface, #fff);
  border: 2px solid var(--lc-warning, #d97706);
  border-radius: var(--lc-radius-lg, 12px);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 4px rgba(217, 119, 6, 0.12);
  width: 460px;
  max-width: calc(100vw - 32px);
  color: var(--lc-text);
  overflow: hidden;
}

.appr-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 10080;
  max-width: calc(100vw - 32px);
  padding: 10px 14px;
  border-radius: var(--lc-radius-sm, 6px);
  background: var(--lc-bg-elevated, #fff);
  border: 1px solid var(--lc-border);
  color: var(--lc-text);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}

.appr-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px 10px;
  border-bottom: 1px solid var(--lc-border);
  background: color-mix(in srgb, var(--lc-warning, #d97706) 8%, transparent);
}

.appr-icon {
  font-size: 16px;
  line-height: 1;
  color: var(--lc-warning, #d97706);
}

.appr-title {
  font-size: 14px;
  font-weight: 600;
  flex: 1;
}

.appr-queue {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--lc-warning, #d97706);
  color: #fff;
}

.appr-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.appr-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.appr-label {
  flex-shrink: 0;
  width: 52px;
  font-size: 11px;
  font-weight: 600;
  color: var(--lc-text-muted);
  padding-top: 2px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.appr-code {
  flex: 1;
  font-family: var(--lc-font-mono, monospace);
  font-size: 12px;
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm, 4px);
  padding: 4px 8px;
  word-break: break-all;
  line-height: 1.5;
  color: var(--lc-text);
}

.appr-code--muted {
  color: var(--lc-text-muted);
}

.appr-val {
  flex: 1;
  font-size: 12px;
  color: var(--lc-text-muted);
}

.appr-error {
  margin: 0 16px 8px;
  font-size: 12px;
  color: var(--lc-error);
}

.appr-info {
  margin: 0 16px 8px;
  font-size: 12px;
  color: var(--lc-text-muted);
}

.appr-hint {
  margin: 4px 0 0;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--lc-text-muted);
  background: color-mix(in srgb, var(--lc-warning, #d97706) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--lc-warning, #d97706) 20%, var(--lc-border));
  border-radius: var(--lc-radius-sm, 6px);
}

.appr-actions {
  display: flex;
  gap: 8px;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--lc-border);
  justify-content: flex-end;
}

.appr-btn {
  padding: 6px 14px;
  border-radius: var(--lc-radius-sm, 6px);
  border: 1px solid var(--lc-border);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.appr-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.appr-btn--deny {
  background: transparent;
  color: var(--lc-error, #dc2626);
  border-color: rgba(220, 38, 38, 0.4);
  margin-right: auto;
}
.appr-btn--deny:hover:not(:disabled) {
  background: color-mix(in srgb, var(--lc-error, #dc2626) 10%, transparent);
}

.appr-btn--once {
  background: var(--lc-bg-elevated);
  color: var(--lc-text);
}
.appr-btn--once:hover:not(:disabled) {
  background: var(--lc-bg-hover);
  border-color: var(--lc-border-strong);
}

.appr-btn--always {
  background: linear-gradient(135deg, #059669, #10b981);
  border-color: rgba(5, 150, 105, 0.5);
  color: #fff;
}
.appr-btn--always:hover:not(:disabled) {
  opacity: 0.9;
}

/* 过渡 */
.appr-fade-enter-active,
.appr-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.appr-fade-enter-from,
.appr-fade-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-8px);
}
</style>
