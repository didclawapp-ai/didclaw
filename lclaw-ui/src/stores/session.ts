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
};

export const useSessionStore = defineStore("session", () => {
  const sessions = ref<SessionRow[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const activeSessionKey = ref<string | null>(null);

  const activeSession = computed(() => sessions.value.find((s) => s.key === activeSessionKey.value) ?? null);

  async function refresh(): Promise<void> {
    const gw = useGatewayStore();
    const c = gw.client;
    if (!c?.connected) {
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const res = await c.request<unknown>("sessions.list", {
        includeGlobal: true,
        includeUnknown: true,
      });
      const parsed = sessionsListResponseSchema.safeParse(res);
      if (!parsed.success) {
        error.value = `会话列表格式异常：${formatZodIssues(parsed.error)}`;
        sessions.value = [];
        return;
      }
      const list = parsed.data.sessions ?? [];
      sessions.value = list.filter((s) => typeof s.key === "string");
      if (sessions.value.length > 0 && !activeSessionKey.value) {
        activeSessionKey.value = sessions.value[0]?.key ?? null;
      }
      const key = activeSessionKey.value;
      if (key) {
        const { useChatStore } = await import("./chat");
        await useChatStore().loadHistory();
      }
    } catch (e) {
      error.value = describeGatewayError(e);
    } finally {
      loading.value = false;
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
  };
});
