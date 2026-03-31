<script setup lang="ts">
import type { SlashCommand } from "@/features/chat/slash-commands";
import { watch, ref, nextTick } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  commands: SlashCommand[];
  activeIndex: number;
}>();

const emit = defineEmits<{
  select: [cmd: SlashCommand];
  close: [];
  "update:activeIndex": [index: number];
}>();

const { t } = useI18n();

const listRef = ref<HTMLUListElement | null>(null);

/** 当 activeIndex 变化时，确保当前高亮项滚动可见 */
watch(
  () => props.activeIndex,
  async (idx) => {
    await nextTick();
    const el = listRef.value?.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  },
);
</script>

<template>
  <div class="slash-picker" role="listbox" :aria-label="t('slash.pickerLabel')">
    <ul ref="listRef" class="slash-list">
      <li
        v-for="(cmd, i) in commands"
        :key="cmd.command"
        role="option"
        :aria-selected="i === activeIndex"
        class="slash-item"
        :class="{ 'slash-item--active': i === activeIndex }"
        @mousedown.prevent="emit('select', cmd)"
        @mouseover="$emit('update:activeIndex', i)"
      >
        <span
          class="slash-cmd"
          :class="{
            'slash-cmd--safe': cmd.risk === 'safe',
            'slash-cmd--caution': cmd.risk === 'caution',
            'slash-cmd--danger': cmd.risk === 'danger',
          }"
        >{{ cmd.command }}<span v-if="cmd.argHint" class="slash-arg">{{ cmd.argHint }}</span></span>
        <span class="slash-desc">{{ t(cmd.descKey) }}</span>
      </li>
    </ul>
    <div class="slash-footer">
      <span>↑↓ {{ t('slash.navHint') }}</span>
      <span>↵ {{ t('slash.confirmHint') }}</span>
      <span>Esc {{ t('slash.closeHint') }}</span>
    </div>
  </div>
</template>

<style scoped>
.slash-picker {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--lc-surface, #fff);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm, 6px);
  box-shadow: var(--lc-shadow-md, 0 8px 24px rgba(0, 0, 0, 0.15));
  overflow: hidden;
  z-index: 200;
  max-height: 280px;
  display: flex;
  flex-direction: column;
}

.slash-list {
  margin: 0;
  padding: 4px 0;
  list-style: none;
  overflow-y: auto;
  flex: 1;
}

.slash-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 7px 14px;
  cursor: pointer;
  transition: background 0.1s ease;
  font-size: 13px;
}

.slash-item--active,
.slash-item:hover {
  background: var(--lc-accent-soft, color-mix(in srgb, var(--lc-accent) 10%, transparent));
}

.slash-cmd {
  font-family: var(--lc-font-mono, monospace);
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}
.slash-cmd--safe    { color: var(--lc-success, #059669); }
.slash-cmd--caution { color: var(--lc-warning, #d97706); }
.slash-cmd--danger  { color: var(--lc-error,   #dc2626); }

.slash-arg {
  font-weight: 400;
  color: var(--lc-text-muted);
  font-size: 12px;
}

.slash-desc {
  color: var(--lc-text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slash-footer {
  display: flex;
  gap: 12px;
  padding: 5px 14px;
  border-top: 1px solid var(--lc-border);
  font-size: 11px;
  color: var(--lc-text-dim, var(--lc-text-muted));
  background: var(--lc-bg-raised, var(--lc-surface));
  flex-shrink: 0;
}
</style>
