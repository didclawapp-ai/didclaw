import { defineAsyncComponent } from "vue";
import type { Component } from "vue";
import type { ChannelDef } from "./types";
import { discordDef } from "./discord/def";
import { feishuDef } from "./feishu/def";
import { googleChatDef } from "./googlechat/def";
import { lineDef } from "./line/def";
import { msTeamsDef } from "./msteams/def";
import { slackDef } from "./slack/def";
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
  {
    ...slackDef,
    panel: defineAsyncComponent(() => import("./slack/SlackPanel.vue")),
  },
  {
    ...msTeamsDef,
    panel: defineAsyncComponent(() => import("./msteams/MsTeamsPanel.vue")),
  },
  {
    ...lineDef,
    panel: defineAsyncComponent(() => import("./line/LinePanel.vue")),
  },
  {
    ...googleChatDef,
    panel: defineAsyncComponent(() => import("./googlechat/GoogleChatPanel.vue")),
  },
];
