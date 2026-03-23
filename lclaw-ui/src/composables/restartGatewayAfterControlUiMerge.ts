import { getLclawDesktopApi } from "@/lib/electron-bridge";

/** 与 `getOpenClawSetupStatus().controlUiAllowedOriginsMerged` 配合：配置已写入磁盘后让网关 reload。 */
export async function restartGatewayAfterControlUiMerge(gw: { disconnect: () => void }): Promise<boolean> {
  const api = getLclawDesktopApi();
  if (!api?.restartOpenClawGateway) {
    return false;
  }
  try {
    const r = await api.restartOpenClawGateway();
    if (r && "ok" in r && r.ok) {
      gw.disconnect();
      await new Promise<void>((resolve) => setTimeout(resolve, 1800));
      // 不在此处 connect：避免首次引导未完成时抢连；由主壳或引导完成后的延迟调度统一连接。
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
