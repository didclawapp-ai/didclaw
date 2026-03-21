<script setup lang="ts">
import { isLclawElectron } from "@/lib/electron-bridge";
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
} = storeToRefs(filePreview);

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
  const api = window.lclawElectron;
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
</script>

<template>
  <div class="preview-root">
    <div class="toolbar">
      <template v-if="target">
        <span class="title" :title="target.url">{{ target.label }}</span>
        <span class="pill">{{ target.kind }}</span>
        <button v-if="canOpenExternal" type="button" @click="openExternal">新窗口打开</button>
        <button type="button" class="ghost" @click="filePreview.clear">关闭预览</button>
      </template>
      <template v-else>
        <p class="hint muted">
          点击左侧消息里的 <strong>蓝色链接按钮</strong>，可预览 PDF / 图片 / <strong>Markdown</strong> /
          <strong>纯文本</strong>；Office 需桌面版或在线嵌入。
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
        'is-empty': !target && !localLoading && !localError,
      }"
    >
      <div v-if="localLoading" class="card state-card">正在加载本地预览…</div>
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
}
.toolbar-pick {
  margin-left: auto;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #333;
  background: #222;
  color: #fff;
  font-size: 12px;
}
.state-card {
  margin: auto;
  max-width: 420px;
}
.state-card.err {
  color: #b71c1c;
}
.state-card.err .fallback-hint {
  margin-top: 12px;
  color: #444;
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
  padding: 6px 12px;
}
.lo-actions .secondary {
  background: #fff;
  color: #222;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding-bottom: 10px;
  margin-bottom: 8px;
  border-bottom: 1px solid #eee;
  flex-shrink: 0;
}
.hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  flex: 1;
  min-width: 0;
}
.title {
  font-weight: 600;
  font-size: 13px;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pill {
  font-size: 10px;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  background: #e8eaf6;
  color: #3949ab;
}
.viewport {
  flex: 1;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fafafa;
}
.viewport.is-empty {
  min-height: 120px;
  border-style: dashed;
  background: #fff;
}
.viewport.is-image {
  align-items: center;
  justify-content: center;
}
.fill-img {
  max-width: 100%;
  max-height: min(70vh, 100%);
  object-fit: contain;
}
.fill-frame {
  flex: 1;
  width: 100%;
  min-height: 320px;
  border: 0;
  background: #fff;
}
.card {
  padding: 16px;
  font-size: 13px;
  line-height: 1.5;
  overflow: auto;
}
.card ul {
  padding-left: 1.2em;
}
button {
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #333;
  background: #222;
  color: #fff;
}
button.ghost {
  background: #fff;
  color: #222;
}
.timeline {
  flex-shrink: 0;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #eee;
  max-height: 180px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.timeline-title {
  font-size: 12px;
  font-weight: 600;
  color: #444;
  margin-bottom: 6px;
}
.timeline-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  font-size: 12px;
}
.timeline-item {
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
}
.ev {
  font-family: ui-monospace, monospace;
  color: #1565c0;
}
.cnt {
  margin-left: 6px;
  color: #888;
  font-size: 11px;
}
.sum {
  margin-top: 4px;
  color: #555;
  word-break: break-word;
  white-space: pre-wrap;
}
.tiny {
  font-size: 12px;
  margin: 0;
}
.muted {
  color: #888;
}
.text-preview {
  flex: 1;
  min-height: 200px;
  margin: 0;
  padding: 12px 16px;
  overflow: auto;
  text-align: left;
  background: #fff;
  border-radius: 0 0 8px 8px;
  font-size: 14px;
  line-height: 1.55;
  box-sizing: border-box;
}
.plain-pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 13px;
  color: #1a1a1a;
}
.md-render :deep(h1),
.md-render :deep(h2),
.md-render :deep(h3) {
  margin: 0.75em 0 0.4em;
  font-weight: 600;
  line-height: 1.3;
}
.md-render :deep(h1) {
  font-size: 1.35em;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.25em;
}
.md-render :deep(p) {
  margin: 0.5em 0;
}
.md-render :deep(ul),
.md-render :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.4em;
}
.md-render :deep(pre) {
  margin: 0.75em 0;
  padding: 10px 12px;
  overflow: auto;
  background: #f6f8fa;
  border-radius: 6px;
  font-size: 12px;
}
.md-render :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.92em;
}
.md-render :deep(p code),
.md-render :deep(li code) {
  background: #f0f0f0;
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
.md-render :deep(a) {
  color: #1565c0;
}
.md-render :deep(table) {
  border-collapse: collapse;
  margin: 0.75em 0;
  font-size: 13px;
}
.md-render :deep(th),
.md-render :deep(td) {
  border: 1px solid #ddd;
  padding: 6px 10px;
}
.md-render :deep(blockquote) {
  margin: 0.6em 0;
  padding-left: 12px;
  border-left: 4px solid #90caf9;
  color: #555;
}
</style>
