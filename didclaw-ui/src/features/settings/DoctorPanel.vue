<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  /** 用户填写的 openclaw 可执行路径（可选，传空则自动查找） */
  executable?: string;
}>();

const { t } = useI18n();

/** 仅来自 ✓ / ⚠ / ✗ 等结构化行的「严重」错误才允许显示自动修复 */
interface DoctorErrorRow {
  text: string;
  severe: boolean;
}

interface DoctorDigest {
  errors: DoctorErrorRow[];
  explicitWarnings: string[];
  memoryEmbedding: boolean;
  apiKeyProviders: string[];
  skillsMissing: number | null;
  suggestionKeys: string[];
  passCount: number;
}

function emptyDigest(): DoctorDigest {
  return {
    errors: [],
    explicitWarnings: [],
    memoryEmbedding: false,
    apiKeyProviders: [],
    skillsMissing: null,
    suggestionKeys: [],
    passCount: 0,
  };
}

const running = ref(false);
const repairing = ref(false);
const error = ref<string | null>(null);
const digest = ref<DoctorDigest>(emptyDigest());
const rawStdout = ref("");
const rawStderr = ref("");
const exitCode = ref<number | null>(null);
const showRaw = ref(false);

function looksLikeHumanText(line: string): boolean {
  return /[\p{L}\p{N}\u4e00-\u9fff]/u.test(line);
}

function pushSuggestionKey(keys: string[], key: string) {
  if (!keys.includes(key)) keys.push(key);
}

/**
 * 聚合 doctor 输出：普通用户只看错误 / 警告 / 建议；详情见原始输出。
 */
function digestDoctorOutput(stdout: string, stderr: string): DoctorDigest {
  const d = emptyDigest();
  const lines = (stdout + "\n" + stderr)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const apiProviders = new Set<string>();

  for (const raw of lines) {
    if (/^[✓✔√]/.test(raw)) {
      d.passCount++;
      continue;
    }
    if (/^[⚠⚡!]/.test(raw) || /^\[warn\]/i.test(raw)) {
      const text = raw.replace(/^[⚠⚡!]\s*|\[warn\]\s*/i, "").trim();
      if (text) d.explicitWarnings.push(text);
      continue;
    }
    if (/^[✗✘×✖]/.test(raw) || /^\[error\]/i.test(raw) || /^\[fail\]/i.test(raw)) {
      const text = raw.replace(/^[✗✘×✖]\s*|\[(error|fail)\]\s*/i, "").trim();
      if (text) d.errors.push({ text, severe: true });
      continue;
    }

    if (!looksLikeHumanText(raw)) continue;

    const norm = raw
      .replace(/^[\s·│|┃◆◇├└┌┐┘┬┴┼─━]+/g, "")
      .replace(/^[·•]\s*/, "")
      .trim();

    const mKey = norm.match(/No API key found for provider "([^"]+)"/i);
    if (mKey) {
      apiProviders.add(mKey[1]);
      continue;
    }

    if (/Memory search is enabled, but no embedding provider is ready/i.test(norm)) {
      d.memoryEmbedding = true;
      continue;
    }
    if (/Semantic recall needs at least one embedding provider/i.test(norm)) continue;
    if (/Gateway memory probe for default agent is not ready/i.test(norm)) continue;

    const mSkills = norm.match(/Missing requirements:\s*(\d+)/i);
    if (mSkills) {
      const n = parseInt(mSkills[1], 10);
      if (!Number.isNaN(n)) d.skillsMissing = Math.max(d.skillsMissing ?? 0, n);
      continue;
    }

    if (/No channel security warnings detected/i.test(norm)) continue;
    if (/Run:\s*`?openclaw security audit/i.test(norm)) {
      pushSuggestionKey(d.suggestionKeys, "suggestSecurityAudit");
      continue;
    }
    if (/Verify:\s*`?openclaw memory status/i.test(norm)) {
      pushSuggestionKey(d.suggestionKeys, "suggestMemoryStatus");
      continue;
    }
    if (/openclaw doctor --fix/i.test(norm) || /Run "openclaw doctor --fix"/i.test(norm)) continue;

    if (/OAuth dir not present/i.test(norm) && /Skipping create/i.test(norm)) {
      pushSuggestionKey(d.suggestionKeys, "suggestOAuthSkip");
      continue;
    }

    if (/Configure auth for this agent/i.test(norm)) continue;
    if (/auth-profiles\.json/i.test(norm)) continue;
    if (/Fix \(pick one\):/i.test(norm)) continue;

    if (/Set OPENAI_API_KEY|GEMINI_API_KEY|VOYAGE_API_KEY|MISTRAL_API_KEY/i.test(norm)) {
      pushSuggestionKey(d.suggestionKeys, "suggestEnvKeys");
      continue;
    }
    if (/Configure credentials:\s*`?openclaw configure/i.test(norm)) {
      pushSuggestionKey(d.suggestionKeys, "suggestOpenclawConfigure");
      continue;
    }
    if (/local embeddings/i.test(norm) && /memorySearch/i.test(norm)) {
      pushSuggestionKey(d.suggestionKeys, "suggestLocalEmbed");
      continue;
    }
    if (/To disable:.*memorySearch\.enabled/i.test(norm)) {
      pushSuggestionKey(d.suggestionKeys, "suggestDisableMemorySearch");
      continue;
    }

    if (/^agents?:\s*main/i.test(norm)) continue;
    if (/heartbeat interval/i.test(norm)) continue;
    if (/session store/i.test(norm)) continue;
    if (/^agent:main:/i.test(norm)) continue;
    if (/doctor complete/i.test(norm)) continue;
    if (/OPENCLAW/i.test(norm) && /🦞/.test(norm)) continue;
    if (/^OpenClaw doctor$/i.test(norm)) continue;
  }

  d.apiKeyProviders = Array.from(apiProviders).sort();
  return d;
}

const displayWarnings = computed(() => {
  const d = digest.value;
  const out: string[] = [...d.explicitWarnings];
  const seen = new Set(out);
  const add = (s: string) => {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };
  if (d.memoryEmbedding) add(t("doctor.warnMemoryEmbedding"));
  if (d.apiKeyProviders.length)
    add(t("doctor.warnApiKeys", { list: d.apiKeyProviders.join(", ") }));
  if (d.skillsMissing != null && d.skillsMissing > 0)
    add(t("doctor.warnSkillsDeps", { n: d.skillsMissing }));
  return out;
});

const displaySuggestions = computed(() =>
  digest.value.suggestionKeys.map((k) => t(`doctor.${k}`)),
);

const hasSevereErrors = computed(() => digest.value.errors.some((e) => e.severe));

const warningCount = computed(() => displayWarnings.value.length);

const topBanner = computed(() => {
  const severe = digest.value.errors.filter((row) => row.severe).length;
  const w = warningCount.value;
  if (severe > 0) return { kind: "fail" as const, text: t("doctor.bannerErrors", { n: severe }) };
  if (digest.value.errors.length > 0)
    return { kind: "warn" as const, text: t("doctor.bannerAbnormalExit") };
  if (w > 0) return { kind: "warn" as const, text: t("doctor.bannerWarnings", { n: w }) };
  if (displaySuggestions.value.length > 0)
    return { kind: "info" as const, text: t("doctor.bannerOkWithTips") };
  if (digest.value.passCount > 0 || (exitCode.value !== null && exitCode.value === 0))
    return { kind: "pass" as const, text: t("doctor.allPassed") };
  return { kind: "info" as const, text: t("doctor.doneMinimal") };
});

const showResults = computed(() => exitCode.value !== null && !error.value);

const hasDetailSections = computed(
  () =>
    digest.value.errors.length > 0 ||
    displayWarnings.value.length > 0 ||
    displaySuggestions.value.length > 0,
);

async function run(repair = false): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.runOpenclawDoctor) {
    error.value = t("doctor.noExe");
    return;
  }

  error.value = null;
  digest.value = emptyDigest();
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
    exitCode.value = r.exitCode ?? null;

    let d = digestDoctorOutput(r.stdout ?? "", r.stderr ?? "");

    if (!r.ok && d.errors.length === 0) {
      d = {
        ...d,
        errors: [
          ...d.errors,
          {
            text: t("doctor.exitNonZero", { code: r.exitCode ?? -1 }),
            severe: false,
          },
        ],
      };
    }

    digest.value = d;
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
        v-if="hasSevereErrors"
        type="button"
        class="doctor-repair-btn ghost"
        :disabled="running || repairing"
        @click="run(true)"
      >
        {{ repairing ? t("doctor.repairing") : t("doctor.repairBtn") }}
      </button>
    </div>

    <div
      v-if="running || repairing"
      class="doctor-progress"
      role="status"
      :aria-label="repairing ? t('doctor.repairing') : t('doctor.running')"
    >
      <div class="doctor-progress-track" aria-hidden="true">
        <div class="doctor-progress-bar" />
      </div>
    </div>

    <p v-if="error" class="err small">{{ error }}</p>

    <div v-if="showResults" class="doctor-results">
      <div class="doctor-summary" :class="`doctor-summary--${topBanner.kind}`">
        {{ topBanner.text }}
        <span v-if="hasSevereErrors" class="doctor-repair-hint"> — {{ t("doctor.repairHint") }}</span>
      </div>

      <div v-if="hasDetailSections" class="doctor-sections">
        <section v-if="digest.errors.length > 0" class="doctor-section doctor-section--errors">
          <h4 class="doctor-section-title">{{ t("doctor.sectionErrors") }}</h4>
          <ul class="doctor-bullet-list">
            <li v-for="(row, idx) in digest.errors" :key="'e' + idx">{{ row.text }}</li>
          </ul>
        </section>

        <section v-if="displayWarnings.length > 0" class="doctor-section doctor-section--warnings">
          <h4 class="doctor-section-title">{{ t("doctor.sectionWarnings") }}</h4>
          <ul class="doctor-bullet-list">
            <li v-for="(w, idx) in displayWarnings" :key="'w' + idx">{{ w }}</li>
          </ul>
        </section>

        <section
          v-if="displaySuggestions.length > 0"
          class="doctor-section doctor-section--suggestions"
        >
          <h4 class="doctor-section-title">{{ t("doctor.sectionSuggestions") }}</h4>
          <ul class="doctor-bullet-list">
            <li v-for="(s, idx) in displaySuggestions" :key="'s' + idx">{{ s }}</li>
          </ul>
        </section>
      </div>

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

/* 单次 IPC 无真实进度，使用 indeterminate 条表示进行中 */
.doctor-progress {
  margin-top: 12px;
}

.doctor-progress-track {
  position: relative;
  height: 5px;
  border-radius: 3px;
  overflow: hidden;
  background: color-mix(in srgb, var(--lc-text-muted) 18%, transparent);
}

.doctor-progress-bar {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 38%;
  border-radius: 3px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--lc-accent) 55%, transparent),
    var(--lc-accent)
  );
  animation: doctor-progress-slide 1.15s ease-in-out infinite;
}

@keyframes doctor-progress-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(320%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .doctor-progress-bar {
    animation: none;
    width: 100%;
    opacity: 0.45;
  }
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
  margin-top: 12px;
}

.doctor-summary {
  font-size: 13px;
  font-weight: 600;
  padding: 8px 10px;
  border-radius: var(--lc-radius-sm);
  margin-bottom: 10px;
  line-height: 1.45;
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

.doctor-summary--info {
  color: var(--lc-text);
  background: color-mix(in srgb, var(--lc-accent) 10%, transparent);
}

.doctor-repair-hint {
  font-weight: 400;
  font-size: 12px;
}

.doctor-sections {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.doctor-section-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.doctor-section--errors .doctor-section-title {
  color: var(--lc-red);
}

.doctor-section--warnings .doctor-section-title {
  color: var(--lc-yellow, #b5860a);
}

.doctor-section--suggestions .doctor-section-title {
  color: var(--lc-text-muted);
}

.doctor-bullet-list {
  margin: 0;
  padding-left: 1.1em;
  font-size: 12px;
  line-height: 1.55;
  color: var(--lc-text);
}

.doctor-bullet-list li + li {
  margin-top: 4px;
}

.doctor-raw-toggle {
  margin-top: 12px;
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
