<script setup lang="ts">
import { useChatStore } from "@/stores/chat";
import { useGatewayStore } from "@/stores/gateway";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  sessionKey: string;
}>();

const { t } = useI18n();
const chat = useChatStore();
const gw = useGatewayStore();
const { status } = storeToRefs(gw);

const draft = computed({
  get: () => chat.surfaces[props.sessionKey]?.draft ?? "",
  set: (v: string) => {
    chat.ensureSurface(props.sessionKey);
    chat.surfaces[props.sessionKey].draft = v;
  },
});

const phase = computed(() => chat.getComposerPhaseFor(props.sessionKey));

const surfaceLastError = computed(() => chat.surfaces[props.sessionKey]?.lastError ?? null);

const roleApiKeyHint = computed(() => {
  const e = surfaceLastError.value;
  if (!e) {
    return null;
  }
  if (/401|invalid\s*api\s*key|api\s*key/i.test(e)) {
    return t("company.rolePanelApiKeyHint");
  }
  return null;
});

const sendVisualState = computed<"offline" | "busy" | "ready">(() => {
  if (status.value !== "connected") {
    return "offline";
  }
  if (phase.value !== "idle") {
    return "busy";
  }
  return "ready";
});

const sendButtonTitle = computed(() => {
  if (sendVisualState.value === "offline") {
    return t("composer.sendOffline");
  }
  if (sendVisualState.value === "busy") {
    return t("composer.sendBusy");
  }
  if (!draft.value.trim()) {
    return t("composer.sendEmpty");
  }
  return t("composer.sendReady");
});

function send(): void {
  void chat.sendMessageForSession(props.sessionKey);
}
</script>

<template>
  <div class="role-composer">
    <textarea
      v-model="draft"
      class="role-composer-input"
      rows="2"
      :placeholder="t('company.roleComposerPlaceholder')"
      @keydown.enter.exact.prevent="send"
    />
    <p v-if="surfaceLastError" class="role-composer-err" role="alert">{{ surfaceLastError }}</p>
    <p v-if="roleApiKeyHint" class="role-composer-hint">{{ roleApiKeyHint }}</p>
    <div class="role-composer-actions">
      <button
        type="button"
        class="lc-btn lc-btn-primary lc-btn-sm"
        :disabled="sendVisualState !== 'ready' || !draft.trim()"
        :title="sendButtonTitle"
        @click="send"
      >
        {{ t("composer.send") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.role-composer {
  padding: 8px 10px 10px;
  border-top: 1px solid var(--lc-border);
  flex-shrink: 0;
  background: var(--lc-bg-raised);
}
.role-composer-input {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 44px;
  max-height: 120px;
  font: inherit;
  padding: 8px 10px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-surface-panel);
  color: var(--lc-text);
  margin-bottom: 8px;
}
.role-composer-actions {
  display: flex;
  justify-content: flex-end;
}
.role-composer-err {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--lc-error);
}
.role-composer-hint {
  margin: 0 0 8px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--lc-text-muted);
}
</style>
