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
import { useFilePreviewStore } from "@/stores/filePreview";
import { useGatewayStore } from "@/stores/gateway";
import { usePreviewStore } from "@/stores/preview";
import { useSessionStore } from "@/stores/session";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";

/** 与参考「流式占位」一致：首包 delta 到达前也显示助手行 */
const STREAMING_PENDING_LABEL = "正在生成回复…";

const gw = useGatewayStore();
const session = useSessionStore();
const chat = useChatStore();
const preview = usePreviewStore();
const filePreview = useFilePreviewStore();

const { followLatest, showDiagnosticMessages } = storeToRefs(preview);
const { status, lastError, helloInfo, url } = storeToRefs(gw);
const { sessions, loading: sessionsLoading, error: sessionsError, activeSessionKey } =
  storeToRefs(session);
const {
  messages,
  historyLoading,
  sending,
  streamText,
  runId,
  draft,
  lastError: chatError,
} = storeToRefs(chat);
const { target: fpTarget, localLoading: fpLocalLoading, localError: fpLocalError } =
  storeToRefs(filePreview);

/** 无预览内容时隐藏右栏；点击链接/本地文件触发 openUrl 后自动展开 */
const isPreviewPaneOpen = computed(
  () =>
    fpTarget.value != null || fpLocalLoading.value === true || fpLocalError.value != null,
);

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
  /** runId 存在即视为本轮生成中，与「先占位、再流式追加」一致 */
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
  /** 默认不展示 system（工具输出、代码块等）；勾选「显示诊断/配置」后可见 */
  return list.filter(
    (line) => line.role !== "system" && !shouldHideDiagnosticChatLine(line.role, line.text),
  );
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

/** 右栏收起时仍可从左侧打开本地文件（与 PreviewPane 内按钮一致） */
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
    <header class="top">
      <div class="brand-row">
        <div class="brand">
          <span class="brand-glyph" aria-hidden="true" />
          <h1 class="brand-title"><span class="brand-name">LCLAW</span> UI</h1>
        </div>
        <p class="brand-tagline">Gateway 会话 · 预览 · 诊断</p>
      </div>
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

    <div class="main" :class="{ 'preview-pane-open': isPreviewPaneOpen }">
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
            <button
              v-if="isLclawElectron() && !isPreviewPaneOpen"
              type="button"
              class="ghost toolbar-mini"
              title="打开本地文件并在右侧预览（PDF / 图片 / Office / Markdown / 文本）"
              @click="pickLocalFileForPreview"
            >
              本地文件…
            </button>
          </div>
        </div>
        <div v-if="historyLoading" class="muted">加载历史…</div>
        <p
          v-else-if="displayLines.length === 0 && messages.length > 0 && !showDiagnosticMessages"
          class="muted filter-hint"
        >
          本会话消息已按规则隐藏（含全部 <strong>system</strong> 行、审计表、路径清单、配置 JSON、仅元数据的助手回复等）。勾选「显示诊断/配置」可查看。
        </p>
        <ChatMessageList
          v-else-if="!historyLoading && displayLines.length > 0"
          :lines="displayLines"
          :selected-index="selectedIndex"
          :follow-latest="followLatest"
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
.top {
  flex: 0 0 auto;
  padding: 14px 20px 16px;
  border-bottom: 1px solid var(--lc-border);
  background: var(--lc-surface-top);
  backdrop-filter: blur(12px);
  box-shadow: var(--lc-shadow-sm);
  position: relative;
}
.top::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: var(--lc-header-line);
  opacity: 0.85;
}
.brand-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 10px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.brand-glyph {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: linear-gradient(135deg, var(--lc-accent), #6366f1);
  box-shadow: 0 0 16px var(--lc-accent-glow);
  transform: rotate(45deg);
}
.brand-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--lc-text);
}
.brand-name {
  background: linear-gradient(105deg, #0e7490 0%, var(--lc-accent) 42%, #4f46e5 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.brand-tagline {
  margin: 0;
  font-size: 12px;
  color: var(--lc-text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.conn {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.url {
  font-family: var(--lc-mono);
  font-size: 11px;
  background: var(--lc-bg-elevated);
  padding: 5px 10px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  color: var(--lc-accent);
  max-width: min(520px, 100%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pill {
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text-muted);
}
.pill[data-s="connected"] {
  border-color: rgba(5, 150, 105, 0.35);
  background: var(--lc-success-bg);
  color: var(--lc-success);
  box-shadow: none;
}
.pill[data-s="error"] {
  border-color: rgba(248, 113, 113, 0.5);
  background: var(--lc-error-bg);
  color: var(--lc-error);
}
.pill[data-s="disconnected"] {
  color: var(--lc-warning);
  border-color: rgba(251, 191, 36, 0.35);
  background: var(--lc-warning-bg);
}
button {
  cursor: pointer;
  padding: 7px 14px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid rgba(6, 182, 212, 0.45);
  background: linear-gradient(165deg, #0e7490 0%, #0891b2 48%, #6366f1 160%);
  color: #f8fafc;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 2px 12px rgba(6, 182, 212, 0.2);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.12s ease;
}
button:hover:not(:disabled) {
  border-color: #06b6d4;
  box-shadow: 0 4px 20px var(--lc-accent-glow);
  transform: translateY(-1px);
}
button:active:not(:disabled) {
  transform: translateY(0);
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}
button.ghost {
  background: transparent;
  border-color: var(--lc-border);
  color: var(--lc-text-muted);
  box-shadow: none;
}
button.ghost:hover:not(:disabled) {
  background: var(--lc-bg-hover);
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
  box-shadow: none;
}
.meta {
  margin: 8px 0 0;
  color: var(--lc-text-muted);
  font-size: 12px;
}
.err {
  color: var(--lc-error);
  margin: 8px 0 0;
}
.err.small {
  font-size: 12px;
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
  font-size: 11px;
  padding: 4px 10px;
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
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}
.sess-btn:hover {
  border-color: var(--lc-border-strong);
  background: var(--lc-bg-elevated);
}
.sess-btn.active {
  border-color: var(--lc-accent);
  background: var(--lc-accent-soft);
  box-shadow: 0 2px 14px rgba(6, 182, 212, 0.15);
  color: #0c4a6e;
}
.composer {
  flex: 0 0 auto;
  padding: 12px 14px 14px;
  border-top: 1px solid var(--lc-border);
  background: var(--lc-surface-composer);
  backdrop-filter: blur(8px);
}
.composer textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  margin-bottom: 6px;
  min-height: 72px;
  padding: 10px 12px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-family: var(--lc-font);
  font-size: 13px;
  line-height: 1.45;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.composer textarea::placeholder {
  color: var(--lc-text-dim);
}
.composer textarea:focus {
  outline: none;
  border-color: var(--lc-border-strong);
  box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.12);
}
.composer textarea:disabled {
  opacity: 0.5;
}
.composer-hint {
  margin: 0 0 8px;
  padding: 0;
  font-size: 11px;
  line-height: 1.35;
  color: var(--lc-text-dim);
}
.row {
  display: flex;
  gap: 10px;
}
.muted {
  color: var(--lc-text-muted);
  padding: 10px 14px;
  font-size: 13px;
}
.diag {
  font-size: 12px;
}
.copied {
  font-size: 12px;
  color: var(--lc-success);
  font-weight: 500;
  animation: lc-fade-in 0.25s ease;
}
@keyframes lc-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
