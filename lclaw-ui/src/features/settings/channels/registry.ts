import { defineAsyncComponent } from "vue";
import type { Component } from "vue";
import type { ChannelDef } from "./types";
import { discordDef } from "./discord/def";
import { feishuDef } from "./feishu/def";
import { wecomDef } from "./wecom/def";
import { wechatDef } from "./wechat/def";
import { whatsappDef } from "./whatsapp/def";

export type ChannelEntry = ChannelDef & { panel: Component };

/**
 * Ordered list of built-in channels displayed in ChannelSetupDialog.
 * To add a new built-in channel: create a folder under channels/, add a def.ts
 * and a Panel.vue, then append one entry here.
 *
 * Dynamic plugin channels discovered from Gateway are merged at runtime
 * by ChannelSetupDialog and rendered via GenericPluginPanel (future).
 */
export const BUILTIN_CHANNELS: ChannelEntry[] = [
  {
    ...whatsappDef,
    panel: defineAsyncComponent(() => import("./whatsapp/WhatsAppPanel.vue")),
  },
  {
    ...wechatDef,
    panel: defineAsyncComponent(() => import("./wechat/WechatPanel.vue")),
  },
  {
    ...feishuDef,
    panel: defineAsyncComponent(() => import("./feishu/FeishuPanel.vue")),
  },
  {
    ...wecomDef,
    panel: defineAsyncComponent(() => import("./wecom/WeComPanel.vue")),
  },
  {
    ...discordDef,
    panel: defineAsyncComponent(() => import("./discord/DiscordPanel.vue")),
  },
];
