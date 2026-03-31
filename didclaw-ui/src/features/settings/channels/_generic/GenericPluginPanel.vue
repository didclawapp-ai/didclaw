<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useChannelContext } from "../base/useChannelContext";
import { useOAuthFlow } from "../base/useOAuthFlow";
import type { ChannelConfigField, ChannelDef } from "../types";

const props = defineProps<{ channelDef: ChannelDef }>();

const { t } = useI18n();
const { busy, showToast, onSuccess } = useChannelContext();

// ── Form state ────────────────────────────────────────────────────────────────

const formValues = reactive<Record<string, string | string[]>>({});
const multiValues = reactive<Record<string, Set<string>>>({});

function getTextValue(key: string): string {
  return typeof formValues[key] === "string" ? (formValues[key] as string) : "";
}

function setTextValue(key: string, val: string): void {
  formValues[key] = val;
}

function isChecked(key: string, val: string): boolean {
  return multiValues[key]?.has(val) ?? false;
}

function toggleMulti(key: string, val: string): void {
  if (!multiValues[key]) multiValues[key] = new Set();
  if (multiValues[key].has(val)) {
    multiValues[key].delete(val);
  } else {
    multiValues[key].add(val);
  }
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

const oauthByKey = new Map<string, ReturnType<typeof useOAuthFlow>>();

function getOAuthFlow(key: string) {
  if (!oauthByKey.has(key)) {
    oauthByKey.set(key, useOAuthFlow(props.channelDef.id));
  }
  return oauthByKey.get(key)!;
}

function oauthBtnLabel(key: string): string {
  const flow = getOAuthFlow(key);
  if (flow.status.value === "pending") return t("channel.plugin.authorizing");
  if (flow.status.value === "complete") return t("channel.plugin.authorizeOk");
  return t("channel.plugin.authorizeBtn");
}

async function handleAuthorize(key: string): Promise<void> {
  const flow = getOAuthFlow(key);
  if (flow.status.value === "pending") return;
  const ok = await flow.startAuth();
  if (ok) showToast(t("channel.plugin.authorizeOk"));
  else showToast(flow.error.value ?? t("channel.plugin.authorizeFail"), true);
}

// ── Fields ────────────────────────────────────────────────────────────────────

const fields = computed<ChannelConfigField[]>(
  () => props.channelDef.configSchema ?? [],
);

const nonOAuthFields = computed(() =>
  fields.value.filter((f) => f.type !== "oauth-button"),
);

const hasOAuthButton = computed(() =>
  fields.value.some((f) => f.type === "oauth-button"),
);

// ── Save ──────────────────────────────────────────────────────────────────────

const saving = ref(false);

async function handleSave(): Promise<void> {
  if (busy.value || saving.value) return;
  const api = getDidClawDesktopApi();
  if (!api?.writeChannelConfig) {
    showToast(t("channel.plugin.noDesktopSave"), true);
    return;
  }

  const payload: Record<string, unknown> = { enabled: true };
  for (const field of nonOAuthFields.value) {
    if (field.type === "multiselect") {
      payload[field.key] = Array.from(multiValues[field.key] ?? []);
    } else {
      payload[field.key] = getTextValue(field.key);
    }
  }

  saving.value = true;
  try {
    const result = await api.writeChannelConfig(props.channelDef.id, payload);
    if (!result.ok) {
      showToast(
        t("channel.plugin.saveFail") +
          `: ${(result as { error?: string }).error ?? ""}`,
        true,
      );
      return;
    }
    showToast(t("channel.plugin.saveOk"));
    onSuccess();
  } finally {
    saving.value = false;
  }
}

const isSensitive = computed(
  () => props.channelDef.privacyLevel === "sensitive",
);
</script>

<template>
  <div class="ch-panel">
    <!-- Privacy notice -->
    <p v-if="isSensitive" class="ch-plugin-warn">
      ⚠️ {{ t("channel.plugin.privacySensitive") }}
    </p>

    <!-- No config schema: show a simple "save to enable" -->
    <template v-if="fields.length === 0">
      <p class="ch-hint">{{ t("channel.plugin.noConfigNeeded") }}</p>
      <div class="ch-actions">
        <button
          type="button"
          class="ch-btn ch-btn--primary"
          :disabled="saving || busy"
          @click="handleSave"
        >
          {{ saving ? t("common.saving") : t("channel.plugin.enableBtn") }}
        </button>
      </div>
    </template>

    <!-- Config fields -->
    <template v-else>
      <div
        v-for="field in nonOAuthFields"
        :key="field.key"
        class="ch-form"
      >
        <label class="ch-label">
          {{ field.label }}
          <span v-if="field.required" class="ch-required">*</span>
        </label>

        <!-- text / password -->
        <input
          v-if="field.type === 'text' || field.type === 'password'"
          :type="field.type"
          class="ch-input"
          :placeholder="field.placeholder ?? ''"
          :value="getTextValue(field.key)"
          @input="setTextValue(field.key, ($event.target as HTMLInputElement).value)"
        >

        <!-- select -->
        <select
          v-else-if="field.type === 'select'"
          class="ch-input"
          :value="getTextValue(field.key)"
          @change="setTextValue(field.key, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ field.placeholder ?? t("channel.plugin.selectPlaceholder") }}</option>
          <option
            v-for="opt in field.options"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>

        <!-- multiselect -->
        <div v-else-if="field.type === 'multiselect'" class="ch-multi">
          <label
            v-for="opt in field.options"
            :key="opt.value"
            class="ch-multi-item"
          >
            <input
              type="checkbox"
              :checked="isChecked(field.key, opt.value)"
              @change="toggleMulti(field.key, opt.value)"
            >
            {{ opt.label }}
          </label>
        </div>
      </div>

      <!-- OAuth buttons (rendered after credential fields) -->
      <div
        v-for="field in fields.filter(f => f.type === 'oauth-button')"
        :key="field.key"
        class="ch-actions"
      >
        <button
          type="button"
          class="ch-btn ch-btn--primary"
          :disabled="getOAuthFlow(field.key).status.value === 'pending'"
          @click="handleAuthorize(field.key)"
        >
          {{ oauthBtnLabel(field.key) }}
        </button>
        <span
          v-if="getOAuthFlow(field.key).status.value === 'pending'"
          class="ch-status-running"
        >
          {{ t("channel.plugin.authorizing") }}
        </span>
        <span
          v-else-if="getOAuthFlow(field.key).status.value === 'complete'"
          class="ch-status-ok"
        >
          ✓ {{ field.label }}
        </span>
      </div>

      <!-- Save button (only shown when there are credential fields) -->
      <div v-if="nonOAuthFields.length > 0 && !hasOAuthButton" class="ch-actions">
        <button
          type="button"
          class="ch-btn ch-btn--primary"
          :disabled="saving || busy"
          @click="handleSave"
        >
          {{ saving ? t("common.saving") : t("channel.saveBtn") }}
        </button>
      </div>
      <div v-else-if="nonOAuthFields.length > 0" class="ch-actions">
        <button
          type="button"
          class="ch-btn"
          :disabled="saving || busy"
          @click="handleSave"
        >
          {{ saving ? t("common.saving") : t("channel.plugin.saveCredentials") }}
        </button>
      </div>
    </template>
  </div>
</template>
