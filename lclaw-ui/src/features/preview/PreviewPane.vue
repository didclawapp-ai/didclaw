<script setup lang="ts">
import { isLclawElectron } from "@/lib/electron-bridge";
import { isHttpsUrl, officeOnlineEmbedUrl } from "@/lib/preview-kind";
import { useFilePreviewStore } from "@/stores/filePreview";
import { useToolTimelineStore } from "@/stores/toolTimeline";
import { storeToRefs } from "pinia";
import { computed } from "vue";

const filePreview = useFilePreviewStore();
const { target, localLoading, localError } = storeToRefs(filePreview);

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
          点击左侧消息里的 <strong>蓝色链接按钮</strong>，在此预览 PDF / 图片；Office 文档见下方说明。
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
      <div v-else-if="localError && !target" class="card state-card err">{{ localError }}</div>
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
        <p>此链接不是内置预览类型（PDF / 图片 / Office）。</p>
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
</style>
