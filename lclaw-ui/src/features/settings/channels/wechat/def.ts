import type { ChannelDef } from "../types";

export const wechatDef: ChannelDef = {
  id: "wechat",
  source: "builtin",
  icon: "🟢",
  nameKey: "channel.wechat.name",
  paradigm: "qr",
  pluginPackageSpec: "@tencent-weixin/openclaw-weixin",
  docLinkKey: "channel.wechat.docLink",
};
