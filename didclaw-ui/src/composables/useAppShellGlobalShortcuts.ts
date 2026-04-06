import { toggleCompanyFeaturesUnlocked } from "@/composables/companyFeaturesDev";
import { isDidClawElectron } from "@/lib/electron-bridge";
import type { ComputedRef, Ref } from "vue";

export type UseAppShellGlobalShortcutsOptions = {
  historyDialogOpen: Ref<boolean>;
  isPreviewPaneOpen: ComputedRef<boolean>;
  clearPreview: () => void;
  pickLocalFileForPreview: () => void | Promise<void>;
  cycleSession: (direction: 1 | -1) => void;
};

export type AppShellGlobalShortcuts = {
  onGlobalKeydown: (event: KeyboardEvent) => void;
};

/**
 * AppShell 全局键盘：Esc 关闭历史对话框、Ctrl+Alt+L 侧栏、Ctrl+Alt+P 预览、
 * Ctrl+Shift+Alt+M（桌面）开关多 Agent 实验入口、Ctrl+Tab 切会话。
 * 返回具名处理器，由 AppShell 在自身的 `onMounted` / `onUnmounted` 里注册，避免与壳内其它
 * `onMounted` 顺序或 HMR 不一致导致 `onGlobalKeydown` 未定义。
 */
export function useAppShellGlobalShortcuts(opts: UseAppShellGlobalShortcutsOptions): AppShellGlobalShortcuts {
  const {
    historyDialogOpen,
    isPreviewPaneOpen,
    clearPreview,
    pickLocalFileForPreview,
    cycleSession,
  } = opts;

  function onGlobalKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && historyDialogOpen.value) {
      historyDialogOpen.value = false;
      return;
    }
    if (
      event.ctrlKey &&
      event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (event.code === "KeyL" || event.key === "l" || event.key === "L")
    ) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent("didclaw-toggle-tool-sidebar"));
      return;
    }
    if (
      event.ctrlKey &&
      event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (event.code === "KeyP" || event.key === "p" || event.key === "P")
    ) {
      event.preventDefault();
      if (isPreviewPaneOpen.value) {
        clearPreview();
      } else if (isDidClawElectron()) {
        void pickLocalFileForPreview();
      }
      return;
    }
    if (
      isDidClawElectron() &&
      event.ctrlKey &&
      event.altKey &&
      event.shiftKey &&
      !event.metaKey &&
      (event.code === "KeyM" || event.key === "m" || event.key === "M")
    ) {
      event.preventDefault();
      toggleCompanyFeaturesUnlocked();
      return;
    }
    if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== "Tab") {
      return;
    }
    event.preventDefault();
    cycleSession(event.shiftKey ? -1 : 1);
  }

  return { onGlobalKeydown };
}
