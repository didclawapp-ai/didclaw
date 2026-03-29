<script setup lang="ts">
type SessionOption = {
  key: string;
  label: string;
  active?: boolean;
  flashing?: boolean;
};

type ModelOption = {
  value: string;
  label: string;
};

defineProps<{
  activeSessionKey: string | null;
  activeSessionLabel: string;
  sessionSelectOptions: SessionOption[];
  sessionsLoading: boolean;
  canCloseActiveSession: boolean;
  canOpenHistorySessions: boolean;
  isDesktop: boolean;
  showOpenClawModelSelect: boolean;
  openClawPrimaryModel: string | null;
  openClawModelPickerRows: ModelOption[];
  openClawPrimaryBusy: boolean;
  openClawPrimaryPickerError: string | null;
  openClawConfigHint: string | null;
}>();

const emit = defineEmits<{
  newChat: [];
  selectSession: [key: string];
  closeActiveSession: [];
  openHistory: [];
  setPrimaryModel: [value: string];
  openAiSettings: [];
}>();
</script>

<template>
  <div class="left-session">
    <div class="panel-title session-panel-head">
      <span class="session-head-label">会话</span>
      <select
        class="session-switch-select"
        :value="activeSessionKey ?? ''"
        :disabled="sessionsLoading || sessionSelectOptions.length === 0"
        :title="activeSessionKey ?? '当前会话'"
        @change="emit('selectSession', ($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>
          {{ activeSessionLabel || "请选择会话" }}
        </option>
        <option
          v-for="row in sessionSelectOptions"
          :key="row.key"
          :value="row.key"
        >
          {{ row.flashing ? "• " : "" }}{{ row.label }}
        </option>
      </select>
      <button
        v-if="canCloseActiveSession"
        type="button"
        class="lc-btn lc-btn-ghost lc-btn-xs session-close-btn"
        title="关闭当前会话（仅从列表隐藏；后续有新消息会再次出现）"
        @click="emit('closeActiveSession')"
      >
        关闭
      </button>
      <button
        type="button"
        class="lc-btn lc-btn-ghost lc-btn-xs session-history-btn"
        :disabled="!canOpenHistorySessions"
        title="查看历史会话并快速切换"
        @click="emit('openHistory')"
      >
        历史
      </button>
      <button
        type="button"
        class="lc-btn lc-btn-ghost lc-btn-xs session-new-btn"
        title="开始一个新的对话（当前对话将保留在历史列表中）"
        @click="emit('newChat')"
      >
        ＋新建
      </button>
      <div v-if="isDesktop" class="session-model-tools">
        <select
          v-if="showOpenClawModelSelect"
          class="session-model-select"
          :value="openClawPrimaryModel ?? ''"
          :disabled="openClawPrimaryBusy"
          :title="
            openClawPrimaryPickerError ??
              '在这里切换「默认用哪个 AI 模型」。选好后会保存到本机；新对话一般会按这个来。'
          "
          @change="emit('setPrimaryModel', ($event.target as HTMLSelectElement).value)"
        >
          <option v-if="!openClawPrimaryModel" value="" disabled>请选择默认模型…</option>
          <option
            v-for="row in openClawModelPickerRows"
            :key="row.value"
            :value="row.value"
          >
            {{ row.label }}
          </option>
        </select>
        <button
          type="button"
          class="lc-btn lc-btn-ghost lc-btn-xs session-model-manage"
          title="打开本机设置，可改密钥、接口地址或恢复备份"
          @click="emit('openAiSettings')"
        >
          更多设置
        </button>
      </div>
    </div>
    <p v-if="isDesktop && openClawPrimaryPickerError" class="session-model-err">
      {{ openClawPrimaryPickerError }}
    </p>
    <p v-if="isDesktop && openClawConfigHint" class="session-config-hint">
      {{ openClawConfigHint }}
    </p>
  </div>
</template>

<style scoped>
.left-session {
  flex-shrink: 0;
}
.panel-title.session-panel-head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 10px 14px;
  text-transform: none;
  letter-spacing: normal;
  font-size: 12px;
}
.session-head-label {
  flex-shrink: 0;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lc-text-muted);
}
.session-switch-select {
  flex: 0 1 clamp(160px, 24vw, 240px);
  min-width: 140px;
  max-width: 240px;
  font-family: var(--lc-font);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  padding: 6px 8px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-accent);
  background: var(--lc-accent-soft);
  color: var(--lc-accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  appearance: none;
  cursor: pointer;
}
.session-switch-select:disabled {
  opacity: 0.55;
  cursor: wait;
}
.session-close-btn,
.session-history-btn,
.session-new-btn {
  flex-shrink: 0;
  padding-inline: 8px;
}
.session-model-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  min-width: 0;
}
.session-model-select {
  flex: 0 1 160px;
  min-width: 72px;
  max-width: min(48%, 220px);
  font-size: 11px;
  font-family: inherit;
  padding: 4px 6px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  cursor: pointer;
}
.session-model-select:disabled {
  opacity: 0.55;
  cursor: wait;
}
.session-model-manage {
  flex-shrink: 0;
  white-space: nowrap;
  padding-inline: 8px;
}
.session-model-err {
  margin: -4px 0 6px;
  padding: 0 14px;
  color: var(--lc-error);
  font-size: 12px;
}
.session-config-hint {
  margin: -2px 0 8px;
  padding: 0 14px;
  line-height: 1.45;
  font-size: 11px;
  color: var(--lc-text-muted);
}
</style>
