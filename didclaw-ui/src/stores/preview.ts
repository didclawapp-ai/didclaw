import { defineStore } from "pinia";
import { ref } from "vue";
import { useFilePreviewStore } from "./filePreview";

/** 右栏预览：选中行 + 「跟随最新」 */
export const usePreviewStore = defineStore("preview", () => {
  const followLatest = ref(true);
  /** 在 followLatest=false 时生效；为 null 则回退到最后一行 */
  const explicitIndex = ref<number | null>(null);
  /** 关闭时隐藏冗长 system / 工具型 assistant / 部分自动 user 输出，减轻历史刷屏 */
  const showDiagnosticMessages = ref(false);

  /** 职务列消息选中（与主栏 `explicitIndex` 分离，避免 `getSelectedIndex` 行数不一致） */
  const rolePanelMessageSelection = ref<{ panelId: string; index: number } | null>(null);

  function getSelectedIndex(lineCount: number): number | null {
    if (lineCount <= 0) {
      return null;
    }
    if (followLatest.value) {
      return lineCount - 1;
    }
    if (explicitIndex.value === null) {
      return lineCount - 1;
    }
    return Math.min(Math.max(0, explicitIndex.value), lineCount - 1);
  }

  function selectLine(index: number, lineCount: number): void {
    followLatest.value = false;
    explicitIndex.value = Math.min(Math.max(0, index), Math.max(0, lineCount - 1));
  }

  function selectRolePanelMessage(panelId: string, index: number, lineCount: number): void {
    const id = panelId.trim();
    const n = Math.max(0, lineCount);
    if (!id || n === 0) {
      rolePanelMessageSelection.value = null;
      return;
    }
    const i = Math.min(Math.max(0, index), n - 1);
    rolePanelMessageSelection.value = { panelId: id, index: i };
  }

  function clearRolePanelMessageSelection(): void {
    rolePanelMessageSelection.value = null;
  }

  function setFollowLatest(value: boolean): void {
    followLatest.value = value;
    if (value) {
      explicitIndex.value = null;
    }
  }

  /** 切换会话或重载历史时恢复「跟随最新」 */
  function resetForNewSession(): void {
    followLatest.value = true;
    explicitIndex.value = null;
    rolePanelMessageSelection.value = null;
    useFilePreviewStore().clear();
  }

  function setShowDiagnosticMessages(value: boolean): void {
    showDiagnosticMessages.value = value;
  }

  return {
    followLatest,
    explicitIndex,
    showDiagnosticMessages,
    rolePanelMessageSelection,
    getSelectedIndex,
    selectLine,
    selectRolePanelMessage,
    clearRolePanelMessageSelection,
    setFollowLatest,
    setShowDiagnosticMessages,
    resetForNewSession,
  };
});
