import type { ChannelDef } from "../types";

export const wecomDef: ChannelDef = {
  id: "wecom",
  source: "builtin",
  icon: "💼",
  nameKey: "channel.wecom.name",
  paradigm: "credential",
  pluginPackageSpec: "@wecom/wecom-openclaw-plugin",
  configPatch: { enabled: true },
  docLinkKey: "channel.wecom.docLink",
};
