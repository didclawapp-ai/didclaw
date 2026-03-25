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

function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
}

export const useThemeStore = defineStore("theme", () => {
  const mode = ref<ThemeMode>(loadSaved());

  applyTheme(mode.value);

  watch(mode, (next) => {
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
  });

  function toggle(): void {
    mode.value = mode.value === "dark" ? "light" : "dark";
  }

  function setMode(next: ThemeMode): void {
    mode.value = next;
  }

  return { mode, toggle, setMode };
});
