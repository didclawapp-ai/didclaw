type GwLike = { connect: () => void };

let deferredTimer: ReturnType<typeof setTimeout> | null = null;

/** 取消待执行的延迟自动连接（用户手动点连接开关时会由 store.connect 调用） */
export function cancelDeferredGatewayConnect(): void {
  if (deferredTimer !== null) {
    clearTimeout(deferredTimer);
    deferredTimer = null;
  }
}

/**
 * 进入主界面后再等一小段时间自动连网关，避免与安装/onboard/冷启抢跑。
 * 默认随机 2～5 秒；可用 minMs/maxMs 覆盖。
 */
export function scheduleDeferredGatewayConnect(
  gw: GwLike,
  opts?: { minMs?: number; maxMs?: number },
): void {
  cancelDeferredGatewayConnect();
  const minMs = opts?.minMs ?? 2000;
  const maxMs = opts?.maxMs ?? 5000;
  const span = Math.max(0, maxMs - minMs);
  const ms = minMs + (span === 0 ? 0 : Math.floor(Math.random() * (span + 1)));
  deferredTimer = window.setTimeout(() => {
    deferredTimer = null;
    gw.connect();
  }, ms);
}
