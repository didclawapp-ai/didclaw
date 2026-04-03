/**
 * 开发构建下记录「有意吞掉的」异常，避免 `catch {}` 完全静默。
 * 生产构建不输出，减少噪音与信息泄露。
 */
export function logSwallowedError(context: string, err: unknown): void {
  if (!import.meta.env.DEV) {
    return;
  }
  console.debug(`[didclaw][${context}]`, err);
}
