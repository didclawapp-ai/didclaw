<script setup lang="ts">
import { segmentTextWithLinks } from "@/lib/extract-chat-links";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import { useFilePreviewStore } from "@/stores/filePreview";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

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
  return isDidClawElectron() && isLocalFileUrl(url);
}

/** Returns true when the URL should be rendered as an inline image rather than a link chip. */
function isImageUrl(url: string): boolean {
  const u = url.trim();
  if (/^data:image\//i.test(u)) return true;
  try {
    const path = new URL(u).pathname.toLowerCase();
    return /\.(png|jpe?g|webp|gif|svg)(\?|$)/.test(path);
  } catch {
    return /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(u);
  }
}

function onLink(url: string, label: string, ev: MouseEvent): void {
  ev.stopPropagation();
  const u = url.trim();
  if (/^data:image\//i.test(u) && filePreview.tryOpenEmbeddedDataImageFromText(u)) {
    return;
  }
  void filePreview.openUrl(url, label);
}

function onImageClick(url: string, label: string, ev: MouseEvent): void {
  ev.stopPropagation();
  void filePreview.openUrl(url, label);
}

/** Track which image URLs failed to load; fall back to link chip */
const failedImages = ref(new Set<string>());
function onImageError(url: string): void {
  failedImages.value = new Set([...failedImages.value, url]);
}

async function ctxSaveAs(): Promise<void> {
  const m = ctxMenu.value;
  if (!m || !canElectronLocalOps(m.url)) {
    return;
  }
  const api = getDidClawDesktopApi();
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
  const api = getDidClawDesktopApi();
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
  const api = getDidClawDesktopApi();
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
  const api = getDidClawDesktopApi();
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
    window.alert(t('chatLine.clipboardError'));
  }
}
</script>

<template>
  <div class="body">
    <template v-for="(seg, i) in segments" :key="i">
      <span v-if="seg.type === 'text'" class="txt-plain">{{ seg.text }}</span>
      <!-- Inline image rendering for image URLs -->
      <template v-else-if="isImageUrl(seg.url) && !failedImages.has(seg.url)">
        <span class="img-block">
          <img
            :src="seg.url"
            :alt="seg.label"
            class="inline-img"
            loading="lazy"
            @click="onImageClick(seg.url, seg.label, $event)"
            @contextmenu="openCtxMenu(seg.url, seg.label, $event)"
            @error="onImageError(seg.url)"
          >
          <span class="img-caption" @click="onImageClick(seg.url, seg.label, $event)">
            {{ t('chatLine.imgCaption') }}
          </span>
        </span>
      </template>
      <!-- Default: link chip for non-image URLs or failed images -->
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
                {{ t('chatLine.ctxSaveAs') }}
              </button>
            </li>
            <li role="none">
              <button type="button" role="menuitem" class="link-ctx-item" @click="ctxOpenSystem">
                {{ t('chatLine.ctxOpenSystem') }}
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                class="link-ctx-item"
                :title="t('chatLine.ctxEmailTitle')"
                @click="ctxEmail"
              >
                {{ t('chatLine.ctxEmail') }}
              </button>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                class="link-ctx-item"
                :title="t('chatLine.ctxShareTitle')"
                @click="ctxShare"
              >
                {{ t('chatLine.ctxShare') }}
              </button>
            </li>
            <li class="link-ctx-sep" role="separator" aria-hidden="true" />
          </template>
          <li role="none">
            <button type="button" role="menuitem" class="link-ctx-item" @click="ctxCopyLink">
              {{ t('chatLine.ctxCopyLink') }}
            </button>
          </li>
        </ul>
      </template>
    </Teleport>
  </div>
</template>

<style scoped>
.body {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.45;
  color: var(--lc-text);
}
.txt-plain {
  white-space: pre-wrap;
}
.link-chip {
  display: inline-block;
  margin: 2px 4px 2px 0;
  padding: 3px 10px;
  max-width: 100%;
  font-size: 11px;
  font-family: var(--lc-mono);
  font-weight: 600;
  color: #0e7490;
  background: linear-gradient(145deg, rgba(6, 182, 212, 0.14), rgba(99, 102, 241, 0.08));
  border: 1px solid rgba(6, 182, 212, 0.35);
  border-radius: 999px;
  cursor: pointer;
  vertical-align: baseline;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background 0.15s ease;
}
.link-chip:hover {
  border-color: var(--lc-accent);
  background: linear-gradient(145deg, rgba(6, 182, 212, 0.22), rgba(99, 102, 241, 0.12));
  box-shadow: 0 2px 10px rgba(6, 182, 212, 0.15);
}
/* ── Inline image ── */
.img-block {
  display: block;
  margin: 8px 0 4px;
  max-width: 100%;
}
.inline-img {
  display: block;
  max-width: 100%;
  max-height: 400px;
  width: auto;
  height: auto;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  box-shadow: var(--lc-shadow-sm);
  cursor: zoom-in;
  transition: box-shadow 0.15s ease, opacity 0.15s ease;
  object-fit: contain;
}
.inline-img:hover {
  box-shadow: var(--lc-shadow-md);
  opacity: 0.92;
}
.img-caption {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--lc-text-muted);
  cursor: pointer;
}
.img-caption:hover {
  color: var(--lc-accent);
  text-decoration: underline;
}
.link-ctx-scrim {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(3px);
}
.link-ctx-menu {
  position: fixed;
  z-index: 9999;
  margin: 0;
  padding: 6px 0;
  min-width: 208px;
  list-style: none;
  font-size: 13px;
  line-height: 1.35;
  color: var(--lc-text);
  background: var(--lc-bg-raised);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  box-shadow: var(--lc-shadow-md);
  backdrop-filter: blur(12px);
}
.link-ctx-item {
  display: block;
  width: 100%;
  margin: 0;
  padding: 9px 16px;
  border: none;
  background: transparent;
  font: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
  transition: background 0.12s ease;
}
.link-ctx-item:hover {
  background: var(--lc-accent-soft);
  color: var(--lc-text);
}
.link-ctx-sep {
  height: 1px;
  margin: 6px 10px;
  padding: 0;
  background: var(--lc-border);
  list-style: none;
}
</style>
