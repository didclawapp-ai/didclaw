import {
  buildListPreview,
  shouldAlwaysHideFromChatList,
  shouldHideDiagnosticChatLine,
} from "@/lib/chat-message-format";
import type { ChatLine } from "@/lib/chat-line";
import { messageToChatLine } from "@/lib/chat-line";
import { useChatStore } from "@/stores/chat";
import { useFilePreviewStore } from "@/stores/filePreview";
import { usePreviewStore } from "@/stores/preview";
import { storeToRefs } from "pinia";
import { computed, type ComputedRef } from "vue";
import { useI18n } from "vue-i18n";

/**
 * 左侧消息列表：展示行、选中索引、点击同步预览区。
 */
export function useAppShellConversationPanel() {
  const { t } = useI18n();
  const chat = useChatStore();
  const preview = usePreviewStore();
  const filePreview = useFilePreviewStore();
  const { messages, historyLoading, streamText, runId } = storeToRefs(chat);
  const { showDiagnosticMessages } = storeToRefs(preview);

  const displayLines = computed((): ChatLine[] => {
    const base = messages.value.map((m) => messageToChatLine(m));
    let list: ChatLine[] = base;
    if (runId.value != null) {
      const raw = streamText.value ?? "";
      const hasBody = raw.trim().length > 0;
      const pendingLabel = t("shell.streaming");
      const streamingContent = hasBody ? raw : pendingLabel;
      list = [
        ...base,
        {
          role: "assistant" as const,
          text: streamingContent,
          listText: hasBody ? buildListPreview(raw) : pendingLabel,
          streaming: true as const,
        },
      ];
    }
    list = list.filter((line) => !shouldAlwaysHideFromChatList(line.role, line.text));
    if (showDiagnosticMessages.value) {
      return list;
    }
    return list.filter(
      (line) => line.role !== "system" && !shouldHideDiagnosticChatLine(line.role, line.text),
    );
  });

  const selectedIndex: ComputedRef<number | null> = computed(() =>
    preview.getSelectedIndex(displayLines.value.length),
  );

  function onSelectMessage(index: number): void {
    preview.clearRolePanelMessageSelection();
    preview.selectLine(index, displayLines.value.length);
    const line = displayLines.value[index];
    if (!line) {
      filePreview.clearChatMessagePreview();
      return;
    }
    if (filePreview.tryOpenEmbeddedDataImageFromText(line.text)) {
      return;
    }
    filePreview.forgetEmbeddedChatImageIfAny();
    filePreview.showChatMessageFullText({
      role: line.role,
      text: line.text,
      listText: line.listText,
    });
  }

  return {
    displayLines,
    selectedIndex,
    onSelectMessage,
    historyLoading,
  };
}
