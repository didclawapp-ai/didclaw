import { sessionsListResponseSchema } from "@/features/gateway/schemas";
import { describeGatewayError } from "@/lib/gateway-errors";
import { formatZodIssues } from "@/lib/zod-format";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useGatewayStore } from "./gateway";

export type SessionRow = {
  key: string;
  label?: string;
  lastActiveAt?: number;
  /** 当前会话的模型覆盖（sessions.patch 设置，null = 使用网关默认） */
  model?: string | null;
};

export const useSessionStore = defineStore("session", () => {
  const sessions = ref<SessionRow[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const activeSessionKey = ref<string | null>(null);

  const activeSession = computed(() => sessions.value.find((s) => s.key === activeSessionKey.value) ?? null);

  /**
   * 刷新会话列表。
   * @returns 若因当前会话切换而已触发 `loadHistory`，返回 `true`；否则 `false`。
   *   避免每次 refresh 都拉历史：否则会清空进行中的 `runId`/`streamText`，表现为「AI 像停住了」。
   */
  async function refresh(): Promise<boolean> {
    const gw = useGatewayStore();
    const c = gw.client;
    if (!c?.connected) {
      return false;
    }
    loading.value = true;
    error.value = null;
    let historyReloaded = false;
    try {
      const res = await c.request<unknown>("sessions.list", {
        includeGlobal: true,
        includeUnknown: true,
      });
      const parsed = sessionsListResponseSchema.safeParse(res);
      if (!parsed.success) {
        error.value = `会话列表格式异常：${formatZodIssues(parsed.error)}`;
        sessions.value = [];
        return false;
      }
      const list = parsed.data.sessions ?? [];
      sessions.value = list.filter((s) => typeof s.key === "string");

      // 新装或尚未产生任何会话时，网关常返回空列表；此时没有 activeSessionKey 会导致无法 chat.send。
      // 与 OpenClaw resolveMainSessionKey 一致：无 agents.list 时默认 agent 为 main，主会话键为 agent:main:main。
      const DEFAULT_MAIN_SESSION_KEY = "agent:main:main";
      if (sessions.value.length === 0) {
        sessions.value = [{ key: DEFAULT_MAIN_SESSION_KEY, label: "main" }];
      }

      const prevKey = activeSessionKey.value;
      if (
        sessions.value.length > 0 &&
        (!prevKey || !sessions.value.some((s) => s.key === prevKey))
      ) {
        activeSessionKey.value = sessions.value[0]?.key ?? null;
      }
      const key = activeSessionKey.value;
      if (key && key !== prevKey) {
        const { useChatStore } = await import("./chat");
        await useChatStore().loadHistory();
        historyReloaded = true;
      }
    } catch (e) {
      error.value = describeGatewayError(e);
    } finally {
      loading.value = false;
    }
    return historyReloaded;
  }

  /**
   * 通过 sessions.patch 设置当前会话的模型覆盖。
   * model 为 null 时清除覆盖，回到网关默认。
   */
  async function patchSessionModel(model: string | null): Promise<void> {
    const gw = useGatewayStore();
    const c = gw.client;
    const key = activeSessionKey.value;
    if (!c?.connected || !key) {
      return;
    }
    try {
      await c.request("sessions.patch", {
        key,
        ...(model != null ? { model } : { model: null }),
      });
      // 更新本地 session row 的 model 字段
      const row = sessions.value.find((s) => s.key === key);
      if (row) {
        row.model = model;
      }
    } catch (e) {
      const { useChatStore } = await import("./chat");
      useChatStore().lastError = `切换模型失败：${describeGatewayError(e)}`;
    }
  }

  async function selectSession(key: string): Promise<void> {
    if (key === activeSessionKey.value) {
      return;
    }
    const { useChatStore } = await import("./chat");
    const { usePreviewStore } = await import("./preview");
    const { useToolTimelineStore } = await import("./toolTimeline");
    const chat = useChatStore();
    const preview = usePreviewStore();
    useToolTimelineStore().clear();
    await chat.abortIfStreaming();
    preview.resetForNewSession();
    activeSessionKey.value = key;
    await chat.loadHistory();
  }

  return {
    sessions,
    loading,
    error,
    activeSessionKey,
    activeSession,
    refresh,
    selectSession,
    patchSessionModel,
  };
});
