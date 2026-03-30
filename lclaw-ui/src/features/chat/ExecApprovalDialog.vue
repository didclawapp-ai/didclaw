<script setup lang="ts">
import { type ApprovalDecision, useApprovalStore } from "@/stores/approval";
import { useGatewayStore } from "@/stores/gateway";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const approvalStore = useApprovalStore();
const gwStore = useGatewayStore();
const { pending } = storeToRefs(approvalStore);

/** 当前展示的审批请求（队列头部） */
const current = computed(() => pending.value[0] ?? null);

const busy = ref(false);
const resolveError = ref<string | null>(null);

/** 将命令数组拼成可读字符串，若没有则回退到 rawCommand */
function displayCommand(req: (typeof pending.value)[0]): string {
  if (!req) return "";
  const plan = req.systemRunPlan;
  if (!plan) return "";
  if (plan.argv?.length) return plan.argv.join(" ");
  return plan.rawCommand ?? "";
}

async function resolve(decision: ApprovalDecision): Promise<void> {
  const req = current.value;
  if (!req || busy.value) return;
  busy.value = true;
  resolveError.value = null;
  try {
    await gwStore.client?.request("exec.approval.resolve", {
      id: req.approvalId,
      decision,
    });
    approvalStore.removePending(req.approvalId);
  } catch (e) {
    resolveError.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
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
            <div class="appr-row">
              <span class="appr-label">{{ t('approval.command') }}</span>
              <code class="appr-code">{{ displayCommand(current) || t('approval.unknownCmd') }}</code>
            </div>
            <div v-if="current.systemRunPlan?.cwd" class="appr-row">
              <span class="appr-label">{{ t('approval.cwd') }}</span>
              <code class="appr-code appr-code--muted">{{ current.systemRunPlan.cwd }}</code>
            </div>
            <div v-if="current.agentId" class="appr-row">
              <span class="appr-label">{{ t('approval.agent') }}</span>
              <span class="appr-val">{{ current.agentId }}</span>
            </div>
          </div>

          <!-- 错误提示 -->
          <p v-if="resolveError" class="appr-error" role="alert">{{ resolveError }}</p>

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
