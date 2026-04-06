<script setup lang="ts">
import ChatMessageList from "@/features/chat/ChatMessageList.vue";
import RolePanelComposer from "@/features/company/RolePanelComposer.vue";
import { sessionKeyBelongsToAgentId } from "@/lib/agent-session-key";
import {
  buildListPreview,
  shouldAlwaysHideFromChatList,
  shouldHideDiagnosticChatLine,
} from "@/lib/chat-message-format";
import type { ChatLine } from "@/lib/chat-line";
import { messageToChatLine } from "@/lib/chat-line";
import type { CompanyRolePanel } from "@/stores/companyRolePanels";
import {
  mainSessionKeyForAgent,
  useCompanyRolePanelsStore,
} from "@/stores/companyRolePanels";
import { useChatStore } from "@/stores/chat";
import { useFilePreviewStore } from "@/stores/filePreview";
import { useGatewayStore } from "@/stores/gateway";
import { usePreviewStore } from "@/stores/preview";
import { useSessionStore } from "@/stores/session";
import { storeToRefs } from "pinia";
import { computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  panel: CompanyRolePanel;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const chat = useChatStore();
const gw = useGatewayStore();
const preview = usePreviewStore();
const filePreview = useFilePreviewStore();
const sessionStore = useSessionStore();
const companyPanels = useCompanyRolePanelsStore();
const { followLatest, showDiagnosticMessages, rolePanelMessageSelection } = storeToRefs(preview);
const { allSessions } = storeToRefs(sessionStore);
const { status: gatewayStatus } = storeToRefs(gw);

const sk = computed(() => props.panel.sessionKey);

const defaultMainKey = computed(() => mainSessionKeyForAgent(props.panel.agentId));

/** 下拉选项：默认 main + 网关返回的该 agent 下所有会话；含当前绑定键（即使暂不在列表） */
const sessionSelectOptions = computed(() => {
  const aid = props.panel.agentId;
  const main = defaultMainKey.value;
  const cur = props.panel.sessionKey;
  const labelByKey = new Map<string, string>();

  if (sessionKeyBelongsToAgentId(main, aid)) {
    labelByKey.set(main, t("company.sessionDefaultMain"));
  }
  for (const row of allSessions.value) {
    if (!sessionKeyBelongsToAgentId(row.key, aid)) {
      continue;
    }
    const lab = row.label?.trim() || row.key;
    if (!labelByKey.has(row.key)) {
      labelByKey.set(row.key, lab);
    }
  }
  if (sessionKeyBelongsToAgentId(cur, aid) && !labelByKey.has(cur)) {
    labelByKey.set(cur, cur);
  }

  const entries = [...labelByKey.entries()];
  entries.sort((a, b) => {
    if (a[0] === main) {
      return -1;
    }
    if (b[0] === main) {
      return 1;
    }
    return a[0].localeCompare(b[0]);
  });
  return entries.map(([key, label]) => ({ key, label }));
});

async function onSessionSelect(ev: Event): Promise<void> {
  const el = ev.target as HTMLSelectElement;
  const nextKey = el.value;
  if (!nextKey || nextKey === props.panel.sessionKey) {
    return;
  }
  await chat.abortIfStreaming({ sessionKey: props.panel.sessionKey });
  const ok = companyPanels.setPanelSessionKey(props.panel.id, nextKey);
  if (!ok) {
    el.value = props.panel.sessionKey;
  }
}

const displayLines = computed((): ChatLine[] => {
  const s = chat.surfaces[sk.value];
  if (!s) {
    return [];
  }
  const base = s.messages.map((m) => messageToChatLine(m));
  let list: ChatLine[] = base;
  if (s.runId != null) {
    const raw = s.streamText ?? "";
    const hasBody = raw.trim().length > 0;
    const pendingLabel = t("shell.streaming");
    const streamingContent = hasBody ? raw : pendingLabel;
    list = [
      ...base,
      {
        role: "assistant" as const,
        text: streamingContent,
        listText: hasBody ? buildListPreview(raw) : pendingLabel,
        streaming: true as const,
      },
    ];
  }
  list = list.filter((line) => !shouldAlwaysHideFromChatList(line.role, line.text));
  if (showDiagnosticMessages.value) {
    return list;
  }
  return list.filter(
    (line) => line.role !== "system" && !shouldHideDiagnosticChatLine(line.role, line.text),
  );
});

const historyLoading = computed(() => chat.surfaces[sk.value]?.historyLoading ?? false);

const messageListSelectedIndex = computed((): number | null => {
  const sel = rolePanelMessageSelection.value;
  if (!sel || sel.panelId !== props.panel.id) {
    return null;
  }
  return sel.index;
});

function onRoleMessageSelect(index: number): void {
  preview.selectRolePanelMessage(props.panel.id, index, displayLines.value.length);
  const line = displayLines.value[index];
  if (!line) {
    filePreview.clearChatMessagePreview();
    return;
  }
  if (filePreview.tryOpenEmbeddedDataImageFromText(line.text)) {
    return;
  }
  filePreview.forgetEmbeddedChatImageIfAny();
  filePreview.showChatMessageFullText({
    role: line.role,
    text: line.text,
    listText: line.listText ?? line.text,
  });
}

watch(
  () => props.panel.sessionKey,
  () => {
    const sel = rolePanelMessageSelection.value;
    if (sel?.panelId === props.panel.id) {
      preview.clearRolePanelMessageSelection();
    }
  },
);

onMounted(() => {
  chat.ensureSurface(sk.value);
  void chat.loadHistory({ sessionKey: sk.value });
});

watch(
  () => props.panel.sessionKey,
  (next, prev) => {
    if (next !== prev) {
      chat.ensureSurface(next);
      void chat.loadHistory({ sessionKey: next });
    }
  },
);

watch(gatewayStatus, (s, prev) => {
  if (s === "connected" && prev !== "connected") {
    chat.ensureSurface(sk.value);
    void chat.loadHistory({ sessionKey: sk.value });
  }
});
</script>

<template>
  <section class="role-col" :aria-label="panel.label">
    <header class="role-col-head">
      <div class="role-col-head-top">
        <span class="role-col-title">{{ panel.label }}</span>
        <span class="role-col-id">{{ panel.agentId }}</span>
        <button type="button" class="role-col-close" :title="t('company.closeRolePanel')" @click="emit('close')">
          ×
        </button>
      </div>
      <label class="role-col-sess-label">
        <span class="sr-only">{{ t("company.sessionSelectLabel") }}</span>
        <select
          class="role-col-sess"
          :value="panel.sessionKey"
          :title="t('company.sessionSelectTitle')"
          @change="onSessionSelect"
        >
          <option v-for="opt in sessionSelectOptions" :key="opt.key" :value="opt.key">
            {{ opt.label }}
          </option>
        </select>
      </label>
    </header>
    <div v-if="historyLoading" class="role-col-loading muted">{{ t("shell.sessionsLoading") }}</div>
    <div class="role-col-messages">
      <ChatMessageList
        :lines="displayLines"
        :selected-index="messageListSelectedIndex"
        :follow-latest="followLatest"
        @select="onRoleMessageSelect"
      />
    </div>
    <RolePanelComposer :session-key="sk" />
  </section>
</template>

<style scoped>
.role-col {
  width: 300px;
  min-width: 280px;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--lc-border);
  background: var(--lc-surface-panel);
}
.role-col-head {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: linear-gradient(180deg, var(--lc-bg-elevated) 0%, var(--lc-bg-raised) 100%);
  border-bottom: 1px solid var(--lc-border);
  font-size: 12px;
}
.role-col-head-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.role-col-sess-label {
  display: block;
  margin: 0;
}
.role-col-sess {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 11px;
  padding: 4px 6px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-surface-panel);
  color: var(--lc-text);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.role-col-title {
  font-weight: 600;
  color: var(--lc-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-col-id {
  color: var(--lc-text-muted);
  font-family: var(--lc-font-mono, monospace);
  font-size: 11px;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.role-col-close {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  color: var(--lc-text-dim);
  padding: 0 4px;
  border-radius: var(--lc-radius-sm);
}
.role-col-close:hover {
  color: var(--lc-text);
  background: var(--lc-bg-elevated);
}
.role-col-loading {
  padding: 8px 10px;
  font-size: 12px;
}
.role-col-messages {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.muted {
  color: var(--lc-text-muted);
}
</style>
