import { isTauri } from "@tauri-apps/api/core";
import { PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ComputedRef, Ref } from "vue";
import { nextTick, watch } from "vue";

/** 关闭预览后保证主窗口内宽不会小于该值（物理像素）；需低于默认窗宽 550 以免被意外拉大 */
const MIN_INNER_WIDTH_PX = 480;

/**
 * 推迟到当前帧的 ResizeObserver 投递结束后再改窗口尺寸，减轻
 * 「ResizeObserver loop completed with undelivered notifications」。
 */
async function waitForLayoutAfterPreviewToggle(): Promise<void> {
  await nextTick();
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => setTimeout(r, 0));
}

/**
 * Tauri 下：打开右侧预览时把主窗口加宽约等于预览列宽，关闭时按同宽度收回，
 * 避免「关掉预览后外壳仍保持左+右总宽度」的体验。
 */
export function useTauriPreviewWindowStrip(
  isPreviewPaneOpen: ComputedRef<boolean>,
  previewPaneRef: Ref<HTMLElement | null>,
): void {
  let expandPx = 0;

  watch(isPreviewPaneOpen, async (open) => {
    if (!isTauri()) {
      return;
    }
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      return;
    }

    if (open) {
      await waitForLayoutAfterPreviewToggle();
      const rw = previewPaneRef.value?.offsetWidth ?? 0;
      if (rw <= 0) {
        return;
      }
      try {
        const iz = await win.innerSize();
        expandPx = rw;
        await win.setSize(new PhysicalSize(iz.width + rw, iz.height));
      } catch {
        expandPx = 0;
      }
      return;
    }

    if (expandPx <= 0) {
      return;
    }
    const delta = expandPx;
    expandPx = 0;
    await waitForLayoutAfterPreviewToggle();
    try {
      const iz = await win.innerSize();
      const nw = Math.max(MIN_INNER_WIDTH_PX, iz.width - delta);
      await win.setSize(new PhysicalSize(nw, iz.height));
    } catch {
      /* ignore */
    }
  });
}
