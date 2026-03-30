import type { ChannelDef } from "../types";

export const wechatDef: ChannelDef = {
  id: "wechat",
  source: "builtin",
  icon: "🟢",
  nameKey: "channel.wechat.name",
  paradigm: "qr",
  pluginPackageSpec: "@tencent-weixin/openclaw-weixin",
  // The Tencent WeChat plugin registers under "openclaw-weixin" in Gateway config
  gatewayChannelId: "openclaw-weixin",
  docLinkKey: "channel.wechat.docLink",
};
