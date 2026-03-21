<script setup lang="ts">
import { segmentTextWithLinks } from "@/lib/extract-chat-links";
import { isLclawElectron } from "@/lib/electron-bridge";
import { useFilePreviewStore } from "@/stores/filePreview";
import { computed, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{
  text: string;
}>();

const filePreview = useFilePreviewStore();
const segments = computed(() => segmentTextWithLinks(props.text));

type CtxMenu = { x: number; y: number; url: string; label: string };
const ctxMenu = ref<CtxMenu | null>(null);

let escHandlerDispose: (() => void) | null = null;

function closeCtxMenu(): void {
  ctxMenu.value = null;
}

watch(ctxMenu, (v) => {
  escHandlerDispose?.();
  escHandlerDispose = null;
  if (!v) {
    return;
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      closeCtxMenu();
    }
  };
  window.addEventListener("keydown", onKey);
  escHandlerDispose = () => window.removeEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
  escHandlerDispose?.();
});

function openCtxMenu(url: string, label: string, ev: MouseEvent): void {
  ev.preventDefault();
  ev.stopPropagation();
  const menuW = 220;
  const menuH = 176;
  const x = Math.min(ev.clientX, window.innerWidth - menuW - 6);
  const y = Math.min(ev.clientY, window.innerHeight - menuH - 6);
  ctxMenu.value = { x, y, url, label };
}

function isLocalFileUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith("file:");
}

function canElectronLocalOps(url: string): boolean {
  return isLclawElectron() && isLocalFileUrl(url);
}

function onLink(url: string, label: string, ev: MouseEvent): void {
  ev.stopPropagation();
  void filePreview.openUrl(url, label);
}

async function ctxSaveAs(): Promise<void> {
  const m = ctxMenu.value;
  if (!m || !canElectronLocalOps(m.url)) {
    return;
  }
  const api = window.lclawElectron;
  if (!api?.saveLocalFileCopyAs) {
    return;
  }
  closeCtxMenu();
  const r = await api.saveLocalFileCopyAs(m.url);
  if (!r.ok) {
    window.alert(r.error);
  }
}

async function ctxOpenSystem(): Promise<void> {
  const m = ctxMenu.value;
  if (!m || !canElectronLocalOps(m.url)) {
    return;
  }
  const api = window.lclawElectron;
  if (!api?.openFileUrlInSystem) {
    return;
  }
  closeCtxMenu();
  const r = await api.openFileUrlInSystem(m.url);
  if (!r.ok) {
    window.alert(r.error);
  }
}

async function ctxEmail(): Promise<void> {
  const m = ctxMenu.value;
  if (!m || !canElectronLocalOps(m.url)) {
    return;
  }
  const api = window.lclawElectron;
  if (!api?.prepareEmailWithLocalFile) {
    return;
  }
  closeCtxMenu();
  const r = await api.prepareEmailWithLocalFile(m.url);
  if (!r.ok) {
    window.alert(r.error);
  }
}

async function ctxShare(): Promise<void> {
  const m = ctxMenu.value;
  if (!m || !canElectronLocalOps(m.url)) {
    return;
  }
  const api = window.lclawElectron;
  if (!api?.copyLocalFileForShare) {
    return;
  }
  closeCtxMenu();
  const r = await api.copyLocalFileForShare(m.url, m.label);
  if (!r.ok) {
    window.alert(r.error);
  }
}

async function ctxCopyLink(): Promise<void> {
  const m = ctxMenu.value;
  if (!m) {
    return;
  }
  closeCtxMenu();
  try {
    await navigator.clipboard.writeText(m.url);
  } catch {
    window.alert("无法写入剪贴板");
  }
}
</script>

<template>
  <div class="body">
    <template v-for="(seg, i) in segments" :key="i">
      <span v-if="seg.type === 'text'" class="txt-plain">{{ seg.text }}</span>
      <button
        v-else
        type="button"
        class="link-chip"
        :title="seg.url"
        @click="onLink(seg.url, seg.label, $event)"
        @contextmenu="openCtxMenu(seg.url, seg.label, $event)"
      >
        {{ seg.label }}
      </button>
    </template>
  </div>

  <Teleport to="body">
    <template v-if="ctxMenu">
      <div
        class="link-ctx-scrim"
        aria-hidden="true"
        @pointerdown="closeCtxMenu"
        @contextmenu.prevent="closeCtxMenu"
      />
      <ul
        class="link-ctx-menu"
        role="menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @pointerdown.stop
      >
        <template v-if="canElectronLocalOps(ctxMenu.url)">
          <li role="none">
            <button type="button" role="menuitem" class="link-ctx-item" @click="ctxSaveAs">
              另存为…
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" class="link-ctx-item" @click="ctxOpenSystem">
              用系统应用打开
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class="link-ctx-item"
              title="在文件夹中显示该文件，并复制路径到剪贴板"
              @click="ctxEmail"
            >
              邮件
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              class="link-ctx-item"
              title="复制文件名、路径与 file 链接"
              @click="ctxShare"
            >
              分享
            </button>
          </li>
          <li class="link-ctx-sep" role="separator" aria-hidden="true" />
        </template>
        <li role="none">
          <button type="button" role="menuitem" class="link-ctx-item" @click="ctxCopyLink">
            复制链接
          </button>
        </li>
      </ul>
    </template>
  </Teleport>
</template>

<style scoped>
.body {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.45;
}
.txt-plain {
  white-space: pre-wrap;
}
.link-chip {
  display: inline-block;
  margin: 2px 4px 2px 0;
  padding: 2px 8px;
  max-width: 100%;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  color: #0d47a1;
  background: #e3f2fd;
  border: 1px solid #90caf9;
  border-radius: 6px;
  cursor: pointer;
  vertical-align: baseline;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
}
.link-chip:hover {
  background: #bbdefb;
}
.link-ctx-scrim {
  position: fixed;
  inset: 0;
  z-index: 9998;
}
.link-ctx-menu {
  position: fixed;
  z-index: 9999;
  margin: 0;
  padding: 4px 0;
  min-width: 200px;
  list-style: none;
  font-size: 13px;
  line-height: 1.35;
  color: #1a1a1a;
  background: #fff;
  border: 1px solid #c5c5c5;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}
.link-ctx-item {
  display: block;
  width: 100%;
  margin: 0;
  padding: 8px 14px;
  border: none;
  background: transparent;
  font: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
}
.link-ctx-item:hover {
  background: #e8f4fc;
}
.link-ctx-sep {
  height: 1px;
  margin: 4px 8px;
  padding: 0;
  background: #e0e0e0;
  list-style: none;
}
</style>
