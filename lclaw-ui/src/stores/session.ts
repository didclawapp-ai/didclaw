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
  /**
   * 本次 `sessions.list` 未返回该键，仅为保留当前聊天区而本地挂接（如一次性定时任务结束后网关从列表移除会话）。
   */
  localOnly?: boolean;
};

const DEFAULT_MAIN_SESSION_KEY = "agent:main:main";

function ghostRowForKey(prevSnap: SessionRow[], key: string): SessionRow {
  const prev = prevSnap.find((s) => s.key === key);
  const raw = (prev?.label ?? key).replace(/（已结束）\s*$/u, "").trim() || key;
  return {
    key,
    label: `${raw}（已结束）`,
    lastActiveAt: prev?.lastActiveAt,
    model: prev?.model,
    localOnly: true,
  };
}

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
      const prevSnap = sessions.value.slice();
      const prevKey = activeSessionKey.value;

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
      const serverSessions = list.filter((s) => typeof s.key === "string") as SessionRow[];

      let merged: SessionRow[];
      if (serverSessions.length === 0) {
        // 新装或尚未产生任何会话时，网关常返回空列表；与 OpenClaw 一致默认主会话键 agent:main:main。
        if (prevKey && prevKey !== DEFAULT_MAIN_SESSION_KEY) {
          merged = [ghostRowForKey(prevSnap, prevKey), { key: DEFAULT_MAIN_SESSION_KEY, label: "main" }];
        } else {
          merged = [{ key: DEFAULT_MAIN_SESSION_KEY, label: "main" }];
        }
      } else if (prevKey && !serverSessions.some((s) => s.key === prevKey)) {
        // 一次性定时任务等结束后，网关会从列表移除会话；勿立刻切回主会话，否则聊天区会像「闪一下又没了」。
        merged = [ghostRowForKey(prevSnap, prevKey), ...serverSessions];
      } else {
        merged = serverSessions;
      }

      sessions.value = merged;

      const activeInMerged =
        activeSessionKey.value != null &&
        merged.some((s) => s.key === activeSessionKey.value);
      if (merged.length > 0 && !activeInMerged) {
        activeSessionKey.value =
          merged.find((s) => s.key === DEFAULT_MAIN_SESSION_KEY)?.key ?? merged[0]?.key ?? null;
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
