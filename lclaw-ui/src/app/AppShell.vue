<script setup lang="ts">
import ChatMessageList from "@/features/chat/ChatMessageList.vue";
import PreviewPane from "@/features/preview/PreviewPane.vue";
import GatewayLocalDialog from "@/features/settings/GatewayLocalDialog.vue";
import {
  buildListPreview,
  shouldAlwaysHideFromChatList,
  shouldHideDiagnosticChatLine,
} from "@/lib/chat-message-format";
import { messageToChatLine } from "@/lib/chat-line";
import { isLclawElectron } from "@/lib/electron-bridge";
import { buildDiagnosticsSnapshot, diagnosticsToPrettyJson } from "@/lib/diagnostics";
import { useChatStore } from "@/stores/chat";
import { useGatewayStore } from "@/stores/gateway";
import { usePreviewStore } from "@/stores/preview";
import { useSessionStore } from "@/stores/session";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";

const gw = useGatewayStore();
const session = useSessionStore();
const chat = useChatStore();
const preview = usePreviewStore();

const { followLatest, showDiagnosticMessages } = storeToRefs(preview);
const { status, lastError, helloInfo, url } = storeToRefs(gw);
const { sessions, loading: sessionsLoading, error: sessionsError, activeSessionKey } =
  storeToRefs(session);
const {
  messages,
  historyLoading,
  sending,
  streamText,
  draft,
  lastError: chatError,
} = storeToRefs(chat);

const copiedDiag = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;
const showGatewayLocal = ref(false);

async function copyDiagnostics(): Promise<void> {
  let tokenConfigured = !!import.meta.env.VITE_GATEWAY_TOKEN?.trim();
  let passwordConfigured = !!import.meta.env.VITE_GATEWAY_PASSWORD?.trim();
  if (isLclawElectron() && window.lclawElectron?.readGatewayLocalConfig) {
    try {
      const c = await window.lclawElectron.readGatewayLocalConfig();
      if (c.token?.trim()) {
        tokenConfigured = true;
      }
      if (c.password?.trim()) {
        passwordConfigured = true;
      }
    } catch {
      /* 忽略 */
    }
  }
  const snapshot = buildDiagnosticsSnapshot({
    version: __APP_VERSION__,
    gatewayWsUrl: url.value,
    connectionStatus: status.value,
    helloInfo: helloInfo.value,
    gatewayLastError: lastError.value,
    sessionListError: sessionsError.value,
    activeSessionKey: activeSessionKey.value,
    sessionCount: sessions.value.length,
    chatLastError: chatError.value,
    messageCount: messages.value.length,
    gatewayTokenConfigured: tokenConfigured,
    gatewayPasswordConfigured: passwordConfigured,
  });
  const text = diagnosticsToPrettyJson(snapshot);
  try {
    await navigator.clipboard.writeText(text);
    copiedDiag.value = true;
    if (copyTimer !== null) {
      clearTimeout(copyTimer);
    }
    copyTimer = window.setTimeout(() => {
      copiedDiag.value = false;
      copyTimer = null;
    }, 2000);
  } catch {
    window.alert("复制失败：请在 https 或 localhost 下打开，并允许浏览器剪贴板权限。");
  }
}

const displayLines = computed(() => {
  const base = messages.value.map((m) => messageToChatLine(m));
  let list = base;
  if (streamText.value?.trim()) {
    const t = streamText.value;
    list = [
      ...base,
      {
        role: "assistant" as const,
        text: t,
        listText: buildListPreview(t),
        streaming: true as const,
      },
    ];
  }
  list = list.filter((line) => !shouldAlwaysHideFromChatList(line.role, line.text));
  if (showDiagnosticMessages.value) {
    return list;
  }
  return list.filter((line) => !shouldHideDiagnosticChatLine(line.role, line.text));
});

const selectedIndex = computed(() => preview.getSelectedIndex(displayLines.value.length));

function onSelectMessage(index: number) {
  preview.selectLine(index, displayLines.value.length);
}

function onComposerEnter(ev: KeyboardEvent): void {
  if (ev.shiftKey) {
    return;
  }
  ev.preventDefault();
  void chat.sendMessage();
}
</script>

<template>
  <div class="shell">
    <header class="top">
      <h1>LCLAW UI</h1>
      <div class="conn">
        <code class="url">{{ url }}</code>
        <span class="pill" :data-s="status">{{ status }}</span>
        <button v-if="status === 'disconnected' || status === 'error'" type="button" @click="gw.connect()">
          连接
        </button>
        <button v-if="status === 'connected'" type="button" class="ghost" @click="gw.disconnect()">
          断开
        </button>
        <button type="button" class="ghost diag" title="复制脱敏 JSON，便于贴到工单/聊天排查" @click="copyDiagnostics">
          复制诊断信息
        </button>
        <button
          v-if="isLclawElectron()"
          type="button"
          class="ghost"
          title="将 Token 等保存到本机（打包版无 .env 时使用）"
          @click="showGatewayLocal = true"
        >
          网关本地设置
        </button>
        <span v-if="copiedDiag" class="copied">已复制</span>
      </div>
      <p v-if="helloInfo" class="meta">{{ helloInfo }}</p>
      <p v-if="lastError" class="err">{{ lastError }}</p>
    </header>

    <GatewayLocalDialog v-model="showGatewayLocal" />

    <div class="main">
      <aside class="left">
        <div class="panel-title">会话</div>
        <p v-if="sessionsError" class="err small">{{ sessionsError }}</p>
        <div v-if="sessionsLoading" class="muted">加载中…</div>
        <ul v-else class="sess">
          <li v-for="s in sessions" :key="s.key">
            <button
              type="button"
              class="sess-btn"
              :class="{ active: s.key === activeSessionKey }"
              @click="session.selectSession(s.key)"
            >
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
          </div>
        </div>
        <div v-if="historyLoading" class="muted">加载历史…</div>
        <p
          v-else-if="displayLines.length === 0 && messages.length > 0 && !showDiagnosticMessages"
          class="muted filter-hint"
        >
          本会话消息已按规则隐藏（审计表、路径清单、配置 JSON、仅元数据的助手回复等）。勾选「显示诊断/配置」可查看。
        </p>
        <ChatMessageList
          v-else-if="!historyLoading && displayLines.length > 0"
          :lines="displayLines"
          :selected-index="selectedIndex"
          @select="onSelectMessage"
        />
        <p v-else-if="!historyLoading && messages.length === 0" class="muted">暂无消息</p>
        <p v-else-if="!historyLoading" class="muted filter-hint">暂无可显示消息。</p>

        <div class="composer">
          <textarea
            v-model="draft"
            rows="3"
            placeholder="输入消息…"
            :disabled="sending || status !== 'connected'"
            @keydown.enter="onComposerEnter"
          />
          <p class="composer-hint">Enter 发送，Shift+Enter 换行</p>
          <div class="row">
            <button type="button" :disabled="sending || status !== 'connected'" @click="chat.sendMessage()">
              发送
            </button>
            <button type="button" class="ghost" :disabled="status !== 'connected'" @click="chat.abortIfStreaming()">
              中断
            </button>
          </div>
          <p v-if="chatError" class="err small">{{ chatError }}</p>
        </div>
      </aside>

      <section class="right">
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
  font-family: system-ui, sans-serif;
  font-size: 14px;
}
.top {
  flex: 0 0 auto;
  padding: 12px 16px;
  border-bottom: 1px solid #ddd;
  background: #fafafa;
}
.top h1 {
  margin: 0 0 8px;
  font-size: 18px;
}
.conn {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.url {
  font-size: 12px;
  background: #eee;
  padding: 2px 6px;
  border-radius: 4px;
}
.pill {
  text-transform: uppercase;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e0e0e0;
}
.pill[data-s="connected"] {
  background: #c8e6c9;
}
.pill[data-s="error"] {
  background: #ffcdd2;
}
button {
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #333;
  background: #222;
  color: #fff;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button.ghost {
  background: #fff;
  color: #222;
}
.meta {
  margin: 6px 0 0;
  color: #555;
  font-size: 12px;
}
.err {
  color: #b00020;
  margin: 6px 0 0;
}
.err.small {
  font-size: 12px;
}
.main {
  flex: 1;
  display: flex;
  min-height: 0;
}
.left {
  flex: 1;
  min-width: 280px;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.right {
  flex: 1;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.preview-wrap {
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.panel-title {
  font-weight: 600;
  padding: 8px 12px;
  background: #f5f5f5;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
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
  font-weight: 400;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.filter-hint {
  font-size: 12px;
  line-height: 1.45;
  margin: 0;
  padding: 8px 12px;
}
.sess {
  list-style: none;
  margin: 0;
  padding: 8px;
  max-height: 160px;
  overflow: auto;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
}
.sess-btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px;
  margin-bottom: 4px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  color: #222;
}
.sess-btn.active {
  border-color: #1976d2;
  background: #e3f2fd;
}
.composer {
  flex: 0 0 auto;
  padding: 8px;
  border-top: 1px solid #ddd;
  background: #fafafa;
}
.composer textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  margin-bottom: 4px;
}
.composer-hint {
  margin: 0 0 8px;
  padding: 0;
  font-size: 11px;
  line-height: 1.35;
  color: #888;
}
.row {
  display: flex;
  gap: 8px;
}
.muted {
  color: #888;
  padding: 8px 12px;
  font-size: 13px;
}
.diag {
  font-size: 12px;
}
.copied {
  font-size: 12px;
  color: #2e7d32;
}
</style>
