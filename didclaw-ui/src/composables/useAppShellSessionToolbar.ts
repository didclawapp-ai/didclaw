import { formatTokenCount } from "@/lib/format-token-count";
import { isDidClawElectron } from "@/lib/electron-bridge";
import { sessionDisplayLabel } from "@/lib/session-display";
import { useChatStore } from "@/stores/chat";
import { useSessionStore } from "@/stores/session";
import { storeToRefs } from "pinia";
import { computed } from "vue";

/**
 * 会话工具栏：标签、下拉选项、Token 摘要、OpenClaw 模型入口显隐、Ctrl+Tab 切会话。
 */
export function useAppShellSessionToolbar() {
  const session = useSessionStore();
  const chat = useChatStore();
  const { sessions, allSessions, activeSessionKey, activeSession } = storeToRefs(session);
  const { openClawModelPickerRows, openClawPrimaryModel, flashingSessionKeys } = storeToRefs(chat);

  const activeSessionLabel = computed(() => {
    const row = activeSession.value;
    if (activeSessionKey.value) {
      return sessionDisplayLabel(activeSessionKey.value, row?.label);
    }
    return "";
  });

  const sessionTokenUsage = computed(() => {
    const row = activeSession.value;
    if (!row) return null;
    const inp = row.inputTokens;
    const out = row.outputTokens;
    if (inp == null && out == null) return null;
    return { in: inp ?? 0, out: out ?? 0 };
  });

  const sessionSelectOptions = computed(() =>
    sessions.value.map((s) => ({
      key: s.key,
      label: sessionDisplayLabel(s.key, s.label),
      active: s.key === activeSessionKey.value,
      flashing: flashingSessionKeys.value.includes(s.key),
    })),
  );

  const canOpenHistorySessions = computed(() => allSessions.value.length > 0);

  const canCloseActiveSession = computed(
    () => Boolean(activeSessionKey.value) && activeSessionKey.value !== "agent:main:main",
  );

  const showOpenClawModelSelect = computed(
    () =>
      isDidClawElectron() &&
      (openClawModelPickerRows.value.length > 0 || Boolean(openClawPrimaryModel.value?.trim())),
  );

  function cycleSession(direction: 1 | -1): void {
    const rows = sessions.value;
    const count = rows.length;
    if (count <= 1) {
      return;
    }
    const current = activeSessionKey.value;
    const currentIndex = rows.findIndex((row) => row.key === current);
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (startIndex + direction + count) % count;
    const nextKey = rows[nextIndex]?.key;
    if (!nextKey || nextKey === current) {
      return;
    }
    void session.selectSession(nextKey);
  }

  return {
    session,
    activeSessionLabel,
    formatTokenCount,
    sessionTokenUsage,
    sessionSelectOptions,
    canOpenHistorySessions,
    canCloseActiveSession,
    showOpenClawModelSelect,
    cycleSession,
  };
}
