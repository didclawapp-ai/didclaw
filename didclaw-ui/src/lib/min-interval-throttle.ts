export type MinIntervalThrottleResult = { ok: true } | { ok: false; msSinceLast: number };

/**
 * 返回一个在 `intervalMs` 内最多触发一次的闸门；用于替代手写 `lastXxxMs`。
 */
export function createMinIntervalThrottle(intervalMs: number): () => MinIntervalThrottleResult {
  let lastFireAt = 0;
  return (): MinIntervalThrottleResult => {
    const now = Date.now();
    if (lastFireAt > 0) {
      const delta = now - lastFireAt;
      if (delta < intervalMs) {
        return { ok: false, msSinceLast: delta };
      }
    }
    lastFireAt = now;
    return { ok: true };
  };
}
