import type { ChannelDef } from "../types";

export const whatsappDef: ChannelDef = {
  id: "whatsapp",
  source: "builtin",
  icon: "💬",
  nameKey: "channel.whatsapp.name",
  paradigm: "qr",
  pluginPackageSpec: "@openclaw/whatsapp",
  configPatch: { enabled: true },
  restartGatewayAfterSetup: true,
  docLinkKey: "channel.whatsapp.docLink",
};
