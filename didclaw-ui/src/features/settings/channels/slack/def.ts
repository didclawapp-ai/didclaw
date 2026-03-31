import type { ChannelDef } from "../types";

export const slackDef: ChannelDef = {
  id: "slack",
  source: "builtin",
  icon: "🔵",
  nameKey: "channel.slack.name",
  paradigm: "credential",
  docLinkKey: "channel.slack.docLink",
};
