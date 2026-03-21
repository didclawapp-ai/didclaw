<script setup lang="ts">
import AppHeader from "@/app/AppHeader.vue";
import ChatRunStatusBar from "@/features/chat/ChatRunStatusBar.vue";
import ChatMessageList from "@/features/chat/ChatMessageList.vue";
import InlineToolTimeline from "@/features/chat/InlineToolTimeline.vue";
import MessageComposer from "@/features/chat/MessageComposer.vue";
import PreviewPane from "@/features/preview/PreviewPane.vue";
import {
  buildListPreview,
  shouldAlwaysHideFromChatList,
  shouldHideDiagnosticChatLine,
} from "@/lib/chat-message-format";
import { messageToChatLine } from "@/lib/chat-line";
import { isLclawElectron } from "@/lib/electron-bridge";
import { useChatStore } from "@/stores/chat";
import { useFilePreviewStore } from "@/stores/filePreview";
import { useGatewayStore } from "@/stores/gateway";
import { usePreviewStore } from "@/stores/preview";
import { useSessionStore } from "@/stores/session";
import { storeToRefs } from "pinia";
import { computed } from "vue";

/** 与参考「流式占位」一致：首包 delta 到达前也显示助手行 */
const STREAMING_PENDING_LABEL = "正在生成回复…";

const session = useSessionStore();
const chat = useChatStore();
const gw = useGatewayStore();
const preview = usePreviewStore();
const filePreview = useFilePreviewStore();

const { followLatest, showDiagnosticMessages } = storeToRefs(preview);
const { status: gwStatus } = storeToRefs(gw);
const { sessions, loading: sessionsLoading, error: sessionsError, activeSessionKey, activeSession } =
  storeToRefs(session);
const { messages, historyLoading, streamText, runId, composerModelKey, composerModelOptions } =
  storeToRefs(chat);
const {
  target: fpTarget,
  localLoading: fpLocalLoading,
  localError: fpLocalError,
  chatMessagePreview: fpChatMessagePreview,
} = storeToRefs(filePreview);

const isPreviewPaneOpen = computed(
  () =>
    fpTarget.value != null ||
    fpLocalLoading.value === true ||
    fpLocalError.value != null ||
    fpChatMessagePreview.value != null,
);

const activeSessionLabel = computed(() => {
  const row = activeSession.value;
  if (row?.label?.trim()) {
    return row.label.trim();
  }
  if (activeSessionKey.value) {
    return activeSessionKey.value;
  }
  return "";
});

/** 标题栏已展示当前会话，下列表只列「可切换到的其他会话」，避免重复大块高亮 */
const otherSessions = computed(() => {
  const cur = activeSessionKey.value;
  if (!cur) {
    return sessions.value;
  }
  return sessions.value.filter((s) => s.key !== cur);
});

const displayLines = computed(() => {
  const base = messages.value.map((m) => messageToChatLine(m));
  let list = base;
  if (runId.value != null) {
    const raw = streamText.value ?? "";
    const hasBody = raw.trim().length > 0;
    const t = hasBody ? raw : STREAMING_PENDING_LABEL;
    list = [
      ...base,
      {
        role: "assistant" as const,
        text: t,
        listText: hasBody ? buildListPreview(raw) : STREAMING_PENDING_LABEL,
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

const selectedIndex = computed(() => preview.getSelectedIndex(displayLines.value.length));

function onSelectMessage(index: number) {
  preview.selectLine(index, displayLines.value.length);
  const line = displayLines.value[index];
  if (line) {
    filePreview.showChatMessageFullText({
      role: line.role,
      text: line.text,
      listText: line.listText,
    });
  } else {
    filePreview.clearChatMessagePreview();
  }
}

async function pickLocalFileForPreview(): Promise<void> {
  const api = window.lclawElectron;
  if (!api) {
    return;
  }
  const href = await api.pickLocalFile();
  if (href) {
    await filePreview.openUrl(href);
  }
}
</script>

<template>
  <div class="shell">
    <AppHeader />

    <div class="main" :class="{ 'preview-pane-open': isPreviewPaneOpen }">
      <aside class="left">
        <div class="panel-title session-panel-head">
          <span class="session-head-label">会话</span>
          <span
            class="session-active-chip"
            :class="{ 'session-active-chip--empty': !activeSessionKey }"
            :title="activeSessionKey ?? '当前会话'"
          >{{ activeSessionLabel || "—" }}</span>
          <select
            class="session-model-select"
            :value="composerModelKey"
            :disabled="gwStatus !== 'connected'"
            title="留空为网关默认。非空时在 chat.send 附带 model（需网关支持）。选项来自 VITE_CHAT_MODEL_OPTIONS（逗号分隔）"
            @change="chat.setComposerModelKey(($event.target as HTMLSelectElement).value)"
          >
            <option value="">默认模型</option>
            <option
              v-if="composerModelKey && !composerModelOptions.includes(composerModelKey)"
              :value="composerModelKey"
            >
              {{ composerModelKey }}
            </option>
            <option v-for="m in composerModelOptions" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
        <p v-if="sessionsError" class="err small">{{ sessionsError }}</p>
        <div v-if="sessionsLoading" class="muted">加载中…</div>
        <ul v-else-if="otherSessions.length > 0" class="sess">
          <li v-for="s in otherSessions" :key="s.key">
            <button type="button" class="sess-btn" @click="session.selectSession(s.key)">
              {{ s.label || s.key }}
            </button>
          </li>
        </ul>

        <div class="panel-title row-title">
          <span>消息</span>
          <div v-if="!historyLoading" class="msg-toolbar">
            <label class="msg-filter">
              <input
                type="checkbox"
                :checked="followLatest"
                @change="preview.setFollowLatest(($event.target as HTMLInputElement).checked)"
              >
              跟随最新
            </label>
            <label class="msg-filter">
              <input
                type="checkbox"
                :checked="showDiagnosticMessages"
                @change="
                  preview.setShowDiagnosticMessages(($event.target as HTMLInputElement).checked)
                "
              >
              显示诊断/配置
            </label>
            <button
              v-if="isLclawElectron() && !isPreviewPaneOpen"
              type="button"
              class="lc-btn lc-btn-ghost lc-btn-xs toolbar-mini"
              title="打开本地文件并在右侧预览（PDF / 图片 / Office / Markdown / 文本）"
              @click="pickLocalFileForPreview"
            >
              本地文件…
            </button>
          </div>
        </div>
        <ChatRunStatusBar />
        <div v-if="historyLoading" class="muted">加载历史…</div>
        <p
          v-else-if="displayLines.length === 0 && messages.length > 0 && !showDiagnosticMessages"
          class="muted filter-hint"
        >
          本会话消息已按规则隐藏（含全部 <strong>system</strong> 行、审计表、路径清单、配置 JSON、仅元数据的助手回复等）。勾选「显示诊断/配置」可查看。
        </p>
        <template v-else-if="!historyLoading && displayLines.length > 0">
          <InlineToolTimeline />
          <ChatMessageList
            :lines="displayLines"
            :selected-index="selectedIndex"
            :follow-latest="followLatest"
            @select="onSelectMessage"
          />
        </template>
        <p v-else-if="!historyLoading && messages.length === 0" class="muted">暂无消息</p>
        <p v-else-if="!historyLoading" class="muted filter-hint">暂无可显示消息。</p>

        <MessageComposer />
      </aside>

      <section v-if="isPreviewPaneOpen" class="right" aria-label="文件预览">
        <div class="panel-title">文件预览</div>
        <div class="preview-wrap">
          <PreviewPane />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: var(--lc-font);
  font-size: 14px;
  color: var(--lc-text);
}
.main {
  flex: 1;
  display: flex;
  min-height: 0;
  gap: 0;
}
.left {
  flex: 1;
  min-width: 280px;
  border-right: 1px solid var(--lc-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--lc-surface-panel);
}
.main:not(.preview-pane-open) .left {
  border-right: none;
}
.right {
  flex: 1;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--lc-surface-panel);
  border-left: 1px solid var(--lc-border);
}
.preview-wrap {
  flex: 1;
  min-height: 0;
  padding: 14px 16px 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.panel-title {
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lc-text-muted);
  padding: 10px 14px;
  background: linear-gradient(180deg, var(--lc-bg-elevated) 0%, var(--lc-bg-raised) 100%);
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.panel-title.session-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  text-transform: none;
  letter-spacing: normal;
  font-size: 12px;
}
.session-head-label {
  flex-shrink: 0;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lc-text-muted);
}
.session-active-chip {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--lc-mono);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.3;
  padding: 4px 8px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-accent);
  background: var(--lc-accent-soft);
  color: #0c4a6e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-active-chip--empty {
  opacity: 0.55;
  border-color: var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text-muted);
}
.session-model-select {
  flex: 0 1 140px;
  min-width: 72px;
  max-width: min(42%, 200px);
  font-size: 11px;
  font-family: inherit;
  padding: 4px 6px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  cursor: pointer;
}
.session-model-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.panel-title.row-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.msg-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.msg-filter {
  font-size: 11px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  white-space: nowrap;
  color: var(--lc-text-dim);
  transition: color 0.15s ease;
}
.msg-filter:hover {
  color: var(--lc-text-muted);
}
.msg-filter input {
  accent-color: var(--lc-accent);
  width: 14px;
  height: 14px;
}
.toolbar-mini {
  margin-left: 0;
}
.filter-hint {
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
  padding: 10px 14px;
  color: var(--lc-text-muted);
}
.filter-hint strong {
  color: var(--lc-accent);
  font-weight: 600;
}
.sess {
  list-style: none;
  margin: 0;
  padding: 10px;
  max-height: 160px;
  overflow: auto;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.sess-btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  margin-bottom: 6px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}
.sess-btn:hover {
  border-color: var(--lc-border-strong);
  background: var(--lc-bg-elevated);
}
.err {
  color: var(--lc-error);
  margin: 8px 0 0;
}
.err.small {
  font-size: 12px;
}
.muted {
  color: var(--lc-text-muted);
  padding: 10px 14px;
  font-size: 13px;
}
</style>
