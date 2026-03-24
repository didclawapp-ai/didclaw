import { hydrateDidClawKvCache } from "@/lib/didclaw-kv";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import "./style.css";

/**
 * 开发时 Chrome 对 ResizeObserver 的提示会走 console.error，Vite 的 forwardConsole 会转发到终端。
 * 在 Vite 已包装过 console 之后再包一层，直接吞掉该条，避免刷屏（生产构建不执行）。
 */
if (import.meta.env.DEV) {
  const resizeObserverLoop = /ResizeObserver loop.*undelivered notifications/i;
  function shouldSuppressResizeObserverLog(args: unknown[]): boolean {
    const first = args[0];
    if (typeof first === "string" && resizeObserverLoop.test(first)) {
      return true;
    }
    if (first instanceof Error && resizeObserverLoop.test(first.message)) {
      return true;
    }
    return false;
  }
  for (const level of ["error", "warn"] as const) {
    const prev = console[level];
    if (typeof prev !== "function") {
      continue;
    }
    console[level] = (...args: unknown[]) => {
      if (shouldSuppressResizeObserverLog(args)) {
        return;
      }
      prev.apply(console, args as never);
    };
  }
  window.addEventListener(
    "error",
    (ev) => {
      if (resizeObserverLoop.test(String(ev.message ?? ""))) {
        ev.stopImmediatePropagation();
      }
    },
    true,
  );
}

void (async () => {
  await hydrateDidClawKvCache();
  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.mount("#app");
})();
