import type { ChannelDef } from "../types";

export const feishuDef: ChannelDef = {
  id: "feishu",
  source: "builtin",
  icon: "🪶",
  nameKey: "channel.feishu.name",
  paradigm: "wizard",
  configPatch: { enabled: true },
  docLinkKey: "channel.feishu.docLink",
};
