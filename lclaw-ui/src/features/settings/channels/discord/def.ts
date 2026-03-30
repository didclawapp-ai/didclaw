import type { ChannelDef } from "../types";

export const discordDef: ChannelDef = {
  id: "discord",
  source: "builtin",
  icon: "🎮",
  nameKey: "channel.discord.name",
  paradigm: "credential",
  configPatch: { enabled: true },
  docLinkKey: "channel.discord.docLink",
};
