import { getLclawDesktopApi } from "@/lib/electron-bridge";

/** 与 `getOpenClawSetupStatus().controlUiAllowedOriginsMerged` 配合：配置已写入磁盘后让网关 reload。 */
export async function restartGatewayAfterControlUiMerge(gw: {
  disconnect: () => void;
  connect: () => void;
}): Promise<boolean> {
  const api = getLclawDesktopApi();
  if (!api?.restartOpenClawGateway) {
    return false;
  }
  try {
    const r = await api.restartOpenClawGateway();
    if (r && "ok" in r && r.ok) {
      gw.disconnect();
      await new Promise<void>((resolve) => setTimeout(resolve, 1800));
      gw.connect();
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
