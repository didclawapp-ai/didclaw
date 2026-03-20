import { defineStore } from "pinia";
import { ref } from "vue";

/** 右栏预览：选中行 + 「跟随最新」 */
export const usePreviewStore = defineStore("preview", () => {
  const followLatest = ref(true);
  /** 在 followLatest=false 时生效；为 null 则回退到最后一行 */
  const explicitIndex = ref<number | null>(null);

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
  }

  return {
    followLatest,
    explicitIndex,
    getSelectedIndex,
    selectLine,
    setFollowLatest,
    resetForNewSession,
  };
});
