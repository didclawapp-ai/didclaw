import { defineStore } from "pinia";
import { ref } from "vue";

export type LocalSettingsTab = "gateway" | "model" | "providers";

/** 顶栏「本机」对话框：可从多处打开并指定初始 Tab */
export const useLocalSettingsStore = defineStore("localSettings", () => {
  const visible = ref(false);
  const initialTab = ref<LocalSettingsTab>("gateway");

  function open(tab: LocalSettingsTab = "gateway") {
    initialTab.value = tab;
    visible.value = true;
  }

  function close() {
    visible.value = false;
  }

  return { visible, initialTab, open, close };
});
