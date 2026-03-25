<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  /** 用户填写的 openclaw 可执行路径（可选，传空则自动查找） */
  executable?: string;
}>();

const { t } = useI18n();

type ItemStatus = "pass" | "warn" | "fail" | "info";
interface DoctorItem {
  status: ItemStatus;
  label: string;
}

const running = ref(false);
const repairing = ref(false);
const error = ref<string | null>(null);
const items = ref<DoctorItem[]>([]);
const rawStdout = ref("");
const rawStderr = ref("");
const exitCode = ref<number | null>(null);
const showRaw = ref(false);

const summary = computed(() => {
  const fails = items.value.filter((i) => i.status === "fail").length;
  const warns = items.value.filter((i) => i.status === "warn").length;
  if (fails > 0) return { kind: "fail" as const, text: t("doctor.hasErrors", { n: fails }) };
  if (warns > 0) return { kind: "warn" as const, text: t("doctor.hasWarnings", { n: warns }) };
  if (items.value.length > 0) return { kind: "pass" as const, text: t("doctor.allPassed") };
  return null;
});

const hasErrors = computed(() => items.value.some((i) => i.status === "fail"));

/**
 * 解析 doctor 输出行，识别 ✓ / ✗ / ⚠ 前缀。
 * 未识别的非空行归为 info。
 */
function parseLines(stdout: string, stderr: string): DoctorItem[] {
  const result: DoctorItem[] = [];
  const lines = (stdout + "\n" + stderr)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/^[✓✔√]/.test(line)) {
      result.push({ status: "pass", label: line.replace(/^[✓✔√]\s*/, "") });
    } else if (/^[⚠⚡!]/.test(line) || /^\[warn\]/i.test(line)) {
      result.push({ status: "warn", label: line.replace(/^[⚠⚡!]\s*|\[warn\]\s*/i, "") });
    } else if (/^[✗✘×✖]/.test(line) || /^\[error\]/i.test(line) || /^\[fail\]/i.test(line)) {
      result.push({ status: "fail", label: line.replace(/^[✗✘×✖]\s*|\[(error|fail)\]\s*/i, "") });
    } else {
      result.push({ status: "info", label: line });
    }
  }
  return result;
}

async function run(repair = false): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.runOpenclawDoctor) {
    error.value = t("doctor.noExe");
    return;
  }

  error.value = null;
  items.value = [];
  rawStdout.value = "";
  rawStderr.value = "";
  exitCode.value = null;
  showRaw.value = false;

  if (repair) {
    repairing.value = true;
  } else {
    running.value = true;
  }

  try {
    const r = await api.runOpenclawDoctor({
      repair,
      executable: props.executable?.trim() || undefined,
    });
    rawStdout.value = r.stdout ?? "";
    rawStderr.value = r.stderr ?? "";
    exitCode.value = r.exitCode;
    items.value = parseLines(r.stdout ?? "", r.stderr ?? "");
    if (!r.ok && items.value.length === 0) {
      error.value = t("doctor.noExe");
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    running.value = false;
    repairing.value = false;
  }
}
</script>

<template>
  <div class="doctor-panel">
    <div class="doctor-actions">
      <button
        type="button"
        class="doctor-run-btn"
        :disabled="running || repairing"
        @click="run(false)"
      >
        {{ running ? t("doctor.running") : t("doctor.runBtn") }}
      </button>
      <button
        v-if="hasErrors || items.length > 0"
        type="button"
        class="doctor-repair-btn ghost"
        :disabled="running || repairing"
        @click="run(true)"
      >
        {{ repairing ? t("doctor.repairing") : t("doctor.repairBtn") }}
      </button>
    </div>

    <p v-if="error" class="err small">{{ error }}</p>

    <div v-if="items.length > 0" class="doctor-results">
      <div v-if="summary" class="doctor-summary" :class="`doctor-summary--${summary.kind}`">
        {{ summary.text }}
        <span v-if="hasErrors" class="doctor-repair-hint">— {{ t("doctor.repairHint") }}</span>
      </div>

      <ul class="doctor-items">
        <li
          v-for="(item, idx) in items"
          :key="idx"
          class="doctor-item"
          :class="`doctor-item--${item.status}`"
        >
          <span class="doctor-item-icon">
            <span v-if="item.status === 'pass'">✓</span>
            <span v-else-if="item.status === 'warn'">⚠</span>
            <span v-else-if="item.status === 'fail'">✗</span>
            <span v-else>·</span>
          </span>
          <span class="doctor-item-label">{{ item.label }}</span>
        </li>
      </ul>

      <div class="doctor-raw-toggle">
        <button type="button" class="ghost small" @click="showRaw = !showRaw">
          {{ showRaw ? "▲" : "▼" }} {{ t("doctor.rawOutput") }}
          <span v-if="exitCode !== null" class="doctor-exit-code muted">
            ({{ t("doctor.exitCode", { code: exitCode }) }})
          </span>
        </button>
        <pre v-if="showRaw" class="doctor-raw">{{ rawStdout || t("doctor.noOutput") }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.doctor-panel {
  margin-top: 10px;
}

.doctor-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.doctor-run-btn {
  font-size: 12px;
  padding: 4px 12px;
}

.doctor-repair-btn {
  font-size: 12px;
  padding: 4px 12px;
}

.doctor-results {
  margin-top: 10px;
}

.doctor-summary {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: var(--lc-radius-sm);
  margin-bottom: 8px;
}

.doctor-summary--pass {
  color: var(--lc-green);
  background: var(--lc-green-soft, color-mix(in srgb, var(--lc-green) 12%, transparent));
}

.doctor-summary--warn {
  color: var(--lc-yellow, #b5860a);
  background: color-mix(in srgb, var(--lc-yellow, #b5860a) 12%, transparent);
}

.doctor-summary--fail {
  color: var(--lc-red);
  background: var(--lc-red-soft, color-mix(in srgb, var(--lc-red) 12%, transparent));
}

.doctor-repair-hint {
  font-weight: 400;
}

.doctor-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.doctor-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  padding: 3px 6px;
  border-radius: var(--lc-radius-sm);
}

.doctor-item--pass {
  color: var(--lc-green);
}

.doctor-item--warn {
  color: var(--lc-yellow, #b5860a);
}

.doctor-item--fail {
  color: var(--lc-red);
  background: color-mix(in srgb, var(--lc-red) 6%, transparent);
}

.doctor-item--info {
  color: var(--lc-text-muted);
}

.doctor-item-icon {
  flex-shrink: 0;
  font-size: 11px;
  width: 14px;
  text-align: center;
}

.doctor-item-label {
  flex: 1;
  word-break: break-word;
}

.doctor-raw-toggle {
  margin-top: 6px;
}

.doctor-raw-toggle button {
  font-size: 11px;
  padding: 2px 6px;
  color: var(--lc-text-muted);
}

.doctor-exit-code {
  font-weight: 400;
}

.doctor-raw {
  margin: 6px 0 0;
  padding: 8px;
  background: var(--lc-bg-code, var(--lc-bg-secondary));
  border-radius: var(--lc-radius-sm);
  font-size: 11px;
  font-family: var(--lc-font-mono, monospace);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
  color: var(--lc-text-muted);
}
</style>
