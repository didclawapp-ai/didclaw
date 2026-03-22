<script setup lang="ts">
import { getLclawDesktopApi, isLclawElectron } from "@/lib/electron-bridge";
import { isLibreOfficeMissingError } from "@/lib/libreoffice-preview";
import { isHttpsUrl, officeOnlineEmbedUrl } from "@/lib/preview-kind";
import { renderMarkdownPreviewToHtml } from "@/lib/render-markdown-preview";
import { useFilePreviewStore } from "@/stores/filePreview";
import { useToolTimelineStore } from "@/stores/toolTimeline";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";

const loRetrying = ref(false);

const filePreview = useFilePreviewStore();
const {
  target,
  localLoading,
  localError,
  pendingLocalFileUrl,
  previewTextBody,
  previewTextError,
  previewTextLoading,
  chatMessagePreview,
  savableEmbeddedImage,
} = storeToRefs(filePreview);

const chatMessageMarkdownHtml = computed(() => {
  const c = chatMessagePreview.value;
  if (!c || c.role !== "assistant") {
    return "";
  }
  return renderMarkdownPreviewToHtml(c.body);
});

const markdownHtml = computed(() => {
  const body = previewTextBody.value;
  if (!body || target.value?.kind !== "markdown") {
    return "";
  }
  return renderMarkdownPreviewToHtml(body);
});

const toolTimeline = useToolTimelineStore();
const { entries: toolEntries } = storeToRefs(toolTimeline);

const officeEmbed = computed(() => {
  const t = target.value;
  if (!t || t.kind !== "office") {
    return "";
  }
  if (!isHttpsUrl(t.url)) {
    return "";
  }
  return officeOnlineEmbedUrl(t.url);
});

const canOpenExternal = computed(() => {
  const u = target.value?.url ?? "";
  return /^https?:\/\//i.test(u) || u.startsWith("file:");
});

function openExternal(): void {
  const u = target.value?.url;
  if (u) {
    window.open(u, "_blank", "noopener,noreferrer");
  }
}

async function pickLocalFile(): Promise<void> {
  const api = getLclawDesktopApi();
  if (!api) {
    return;
  }
  const href = await api.pickLocalFile();
  if (href) {
    void filePreview.openUrl(href);
  }
}

const showLibreOfficeHints = computed(
  () =>
    isLclawElectron() &&
    Boolean(pendingLocalFileUrl.value) &&
    isLibreOfficeMissingError(localError.value),
);

async function onLibreOfficeRetry(): Promise<void> {
  loRetrying.value = true;
  try {
    await filePreview.retryPendingLocalPreview();
  } finally {
    loRetrying.value = false;
  }
}

async function onSaveEmbeddedImage(): Promise<void> {
  const r = await filePreview.saveEmbeddedImageAs();
  if (!r.ok) {
    window.alert(r.error);
  }
}
</script>

<template>
  <div class="preview-root">
    <div class="toolbar">
      <template v-if="target || chatMessagePreview">
        <span class="title" :title="target?.url ?? ''">{{
          chatMessagePreview?.title ?? target?.label
        }}</span>
        <span class="pill">{{
          chatMessagePreview
            ? chatMessagePreview.role === "assistant"
              ? "chat-md"
              : "chat-txt"
            : target?.kind
        }}</span>
        <button v-if="target && canOpenExternal" type="button" @click="openExternal">新窗口打开</button>
        <button
          v-if="savableEmbeddedImage"
          type="button"
          class="save-embedded"
          @click="onSaveEmbeddedImage"
        >
          另存为…
        </button>
        <button type="button" class="ghost" @click="filePreview.clear">关闭预览</button>
      </template>
      <template v-else>
        <p class="hint muted">
          点击左侧消息里的 <strong>高亮链接</strong> 可预览文件；若某行提示「列表截断」，<strong>点该行</strong>可在右侧查看全文。
          含 <strong>data:image/…;base64,…</strong> 的助手/用户消息<strong>点该行</strong>可在右侧预览并另存。
          支持 PDF / 图片 / <strong>Markdown</strong> / <strong>纯文本</strong>；Office 需桌面版或在线嵌入。
        </p>
        <button v-if="isLclawElectron()" type="button" class="toolbar-pick" @click="pickLocalFile">
          选择本地文件…
        </button>
      </template>
    </div>

    <div
      class="viewport"
      :class="{
        'is-image': target?.kind === 'image',
        'is-empty': !target && !chatMessagePreview && !localLoading && !localError,
      }"
    >
      <div v-if="localLoading" class="card state-card">正在加载本地预览…</div>
      <div
        v-else-if="chatMessagePreview && chatMessagePreview.role === 'assistant'"
        class="text-preview md-render chat-msg-full"
        v-html="chatMessageMarkdownHtml"
      />
      <pre
        v-else-if="chatMessagePreview"
        class="text-preview plain-pre chat-msg-full"
      >{{ chatMessagePreview.body }}</pre>
      <div v-else-if="target && previewTextLoading" class="card state-card">正在加载文本…</div>
      <div
        v-else-if="
          target && (target.kind === 'markdown' || target.kind === 'text') && previewTextError
        "
        class="card state-card err"
      >
        <p>{{ previewTextError }}</p>
        <button v-if="canOpenExternal" type="button" class="fallback-btn" @click="openExternal">
          新窗口打开
        </button>
      </div>
      <div
        v-else-if="target?.kind === 'markdown' && previewTextBody"
        class="text-preview md-render"
        v-html="markdownHtml"
      />
      <pre
        v-else-if="target?.kind === 'text' && previewTextBody"
        class="text-preview plain-pre"
      >{{ previewTextBody }}</pre>
      <div v-else-if="localError && !target" class="card state-card err">
        <p>{{ localError }}</p>
        <template v-if="showLibreOfficeHints">
          <p class="fallback-hint">
            <strong>LibreOffice</strong> 为免费开源办公套件，用于在右侧将 Office 转为 PDF 预览。也可使用本机已安装的 Word / WPS 直接打开文件。
          </p>
          <div class="lo-actions">
            <button type="button" class="primary" @click="filePreview.showLibreOfficeInstallDialog()">
              安装说明与下载页…
            </button>
            <button type="button" class="secondary" @click="filePreview.openLibreOfficeDownloadPage()">
              直接打开官网
            </button>
            <button type="button" class="secondary" :disabled="loRetrying" @click="onLibreOfficeRetry()">
              {{ loRetrying ? "检测中…" : "重新检测并预览" }}
            </button>
          </div>
        </template>
        <p v-else-if="isLclawElectron() && pendingLocalFileUrl" class="fallback-hint">
          若已安装 <strong>Microsoft Office</strong> 或 WPS，可用系统默认程序打开。
        </p>
        <button
          v-if="isLclawElectron() && pendingLocalFileUrl"
          type="button"
          class="fallback-btn"
          @click="filePreview.openPendingLocalInSystemApp()"
        >
          用系统应用打开此文件
        </button>
      </div>
      <img
        v-else-if="target?.kind === 'image'"
        class="fill-img"
        :src="target.url"
        :alt="target.label"
      >
      <iframe
        v-else-if="target && target.kind === 'pdf'"
        class="fill-frame"
        title="PDF"
        :src="target.url"
      />
      <iframe
        v-else-if="target && target.kind === 'office' && officeEmbed"
        class="fill-frame"
        title="Office"
        :src="officeEmbed"
      />
      <div v-else-if="target && target.kind === 'office'" class="card">
        <p><strong>本地或 HTTP 的 Office 文件</strong>在浏览器里无法像桌面一样直接打开。</p>
        <ul>
          <li>若为 <strong>https</strong> 且公网可访问，已尝试用 Microsoft 在线预览（上方嵌入）。</li>
          <li><strong>file://</strong> 或内网地址：请用「新窗口打开」或在本机资源管理器中打开路径。</li>
        </ul>
        <button type="button" @click="openExternal">仍要尝试打开</button>
      </div>
      <div v-else-if="target" class="card">
        <p>此链接不是内置预览类型（PDF / 图片 / Office / Markdown / 文本）。</p>
        <button type="button" @click="openExternal">在新窗口打开</button>
      </div>
    </div>

    <div class="timeline">
      <div class="timeline-title">工具 / 事件（非 chat）</div>
      <ul v-if="toolEntries.length" class="timeline-list">
        <li v-for="e in toolEntries" :key="e.id" class="timeline-item">
          <span class="ev">{{ e.event }}</span>
          <span v-if="e.count > 1" class="cnt">×{{ e.count }}</span>
          <div class="sum">{{ e.summary || "—" }}</div>
        </li>
      </ul>
      <p v-else class="muted tiny">暂无。除 <code>chat</code> / <code>connect.challenge</code> 外的下行事件经合并后显示。</p>
    </div>
  </div>
</template>

<style scoped>
.preview-root {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  color: var(--lc-text);
}
.toolbar-pick {
  margin-left: auto;
  cursor: pointer;
  padding: 7px 14px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid rgba(6, 182, 212, 0.45);
  background: linear-gradient(165deg, #0e7490 0%, #0891b2 48%, #6366f1 160%);
  color: #f8fafc;
  font-size: 12px;
  font-weight: 500;
  box-shadow: 0 2px 12px rgba(6, 182, 212, 0.18);
}
.toolbar-pick:hover {
  border-color: #06b6d4;
  box-shadow: 0 4px 18px var(--lc-accent-glow);
}
.state-card {
  margin: auto;
  max-width: 420px;
  padding: 20px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
  color: var(--lc-text-muted);
}
.state-card.err {
  color: var(--lc-error);
  border-color: rgba(248, 113, 113, 0.35);
  background: var(--lc-error-bg);
}
.state-card.err .fallback-hint {
  margin-top: 12px;
  color: var(--lc-text-muted);
  font-size: 13px;
  line-height: 1.5;
}
.fallback-btn {
  margin-top: 12px;
}
.lo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.lo-actions .primary,
.lo-actions .secondary {
  font-size: 12px;
  padding: 7px 12px;
  border-radius: var(--lc-radius-sm);
  cursor: pointer;
}
.lo-actions .primary {
  border: 1px solid rgba(6, 182, 212, 0.45);
  background: linear-gradient(165deg, #0e7490 0%, #0891b2 50%, #6366f1 160%);
  color: #f8fafc;
}
.lo-actions .secondary {
  background: transparent;
  border: 1px solid var(--lc-border);
  color: var(--lc-text-muted);
}
.lo-actions .secondary:hover {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding-bottom: 12px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--lc-border);
  flex-shrink: 0;
}
.hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  flex: 1;
  min-width: 0;
}
.hint strong {
  color: var(--lc-accent);
  font-weight: 600;
}
.title {
  font-weight: 600;
  font-size: 13px;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--lc-text);
}
.pill {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid rgba(124, 58, 237, 0.25);
  background: var(--lc-violet-soft);
  color: #6d28d9;
}
.viewport {
  flex: 1;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: var(--lc-bg-raised);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
}
.viewport.is-empty {
  min-height: 120px;
  border-style: dashed;
  border-color: rgba(6, 182, 212, 0.28);
  background: var(--lc-bg-elevated);
}
.viewport.is-image {
  align-items: center;
  justify-content: center;
}
.fill-img {
  max-width: 100%;
  max-height: min(70vh, 100%);
  object-fit: contain;
  border-radius: 4px;
}
.fill-frame {
  flex: 1;
  width: 100%;
  min-height: 320px;
  border: 0;
  background: #f8fafc;
}
.card {
  padding: 16px;
  font-size: 13px;
  line-height: 1.55;
  overflow: auto;
  color: var(--lc-text-muted);
}
.card ul {
  padding-left: 1.2em;
}
.card strong {
  color: var(--lc-text);
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
}
button:hover {
  border-color: #06b6d4;
  box-shadow: 0 4px 16px rgba(6, 182, 212, 0.2);
}
button.ghost {
  background: transparent;
  border-color: var(--lc-border);
  color: var(--lc-text-muted);
  box-shadow: none;
}
button.ghost:hover {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
  box-shadow: none;
}
.timeline {
  flex-shrink: 0;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--lc-border);
  max-height: 180px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.timeline-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lc-text-dim);
  margin-bottom: 8px;
}
.timeline-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  font-size: 12px;
}
.timeline-item {
  padding: 8px 0;
  border-bottom: 1px solid var(--lc-border);
}
.ev {
  font-family: var(--lc-mono);
  color: var(--lc-accent);
  font-size: 11px;
}
.cnt {
  margin-left: 6px;
  color: var(--lc-text-dim);
  font-size: 11px;
}
.sum {
  margin-top: 4px;
  color: var(--lc-text-muted);
  word-break: break-word;
  white-space: pre-wrap;
}
.tiny {
  font-size: 12px;
  margin: 0;
}
.muted {
  color: var(--lc-text-muted);
}
.text-preview {
  flex: 1;
  min-height: 200px;
  margin: 0;
  padding: 14px 18px;
  overflow: auto;
  text-align: left;
  background: var(--lc-bg-raised);
  border-radius: 0 0 var(--lc-radius-sm) var(--lc-radius-sm);
  font-size: 14px;
  line-height: 1.6;
  box-sizing: border-box;
  color: var(--lc-text);
}
.plain-pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--lc-mono);
  font-size: 13px;
  color: var(--lc-text);
}
.md-render :deep(h1),
.md-render :deep(h2),
.md-render :deep(h3) {
  margin: 0.75em 0 0.4em;
  font-weight: 600;
  line-height: 1.3;
  color: var(--lc-text);
}
.md-render :deep(h1) {
  font-size: 1.35em;
  border-bottom: 1px solid var(--lc-border);
  padding-bottom: 0.25em;
}
.md-render :deep(p) {
  margin: 0.5em 0;
  color: var(--lc-text-muted);
}
.md-render :deep(ul),
.md-render :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.4em;
  color: var(--lc-text-muted);
}
.md-render :deep(pre) {
  margin: 0.75em 0;
  padding: 12px 14px;
  overflow: auto;
  background: #f1f5f9;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  font-size: 12px;
  color: #1e293b;
}
.md-render :deep(code) {
  font-family: var(--lc-mono);
  font-size: 0.92em;
}
.md-render :deep(p code),
.md-render :deep(li code) {
  background: #f1f5f9;
  border: 1px solid var(--lc-border);
  padding: 0.12em 0.4em;
  border-radius: 4px;
  color: #0e7490;
}
.md-render :deep(a) {
  color: var(--lc-accent);
}
.md-render :deep(table) {
  border-collapse: collapse;
  margin: 0.75em 0;
  font-size: 13px;
}
.md-render :deep(th),
.md-render :deep(td) {
  border: 1px solid var(--lc-border);
  padding: 6px 10px;
  color: var(--lc-text-muted);
}
.md-render :deep(th) {
  background: var(--lc-bg-elevated);
  color: var(--lc-text);
}
.md-render :deep(blockquote) {
  margin: 0.6em 0;
  padding-left: 12px;
  border-left: 3px solid var(--lc-accent);
  color: var(--lc-text-muted);
}
</style>
