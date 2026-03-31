import { defineStore } from "pinia";
import { ref, watch } from "vue";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "didclaw_theme";

function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function loadSaved(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return prefersDark() ? "dark" : "light";
}

function applyWebviewTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
}

/** 同步 Tauri 原生标题栏深/浅色（仅桌面端有效，浏览器环境静默忽略） */
async function applyNativeTitleBarTheme(mode: ThemeMode): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(mode === "dark" ? "dark" : "light");
  } catch {
    // 非 Tauri 环境或权限不足时静默忽略
  }
}

export const useThemeStore = defineStore("theme", () => {
  const mode = ref<ThemeMode>(loadSaved());

  // 初始化时同步两侧
  applyWebviewTheme(mode.value);
  void applyNativeTitleBarTheme(mode.value);

  watch(mode, (next) => {
    applyWebviewTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    void applyNativeTitleBarTheme(next);
  });

  function toggle(): void {
    mode.value = mode.value === "dark" ? "light" : "dark";
  }

  function setMode(next: ThemeMode): void {
    mode.value = next;
  }

  return { mode, toggle, setMode };
});
