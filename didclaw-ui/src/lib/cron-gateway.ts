/**
 * OpenClaw Gateway 定时任务相关响应解析（宽松，兼容版本差异）。
 * 行为对齐官方 Control UI：`openclaw-src/ui/src/ui/controllers/cron.ts`。
 */

export type CronPageMeta = {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
};

export function normalizeCronPageMeta(params: {
  totalRaw?: unknown;
  limitRaw?: unknown;
  offsetRaw?: unknown;
  nextOffsetRaw?: unknown;
  hasMoreRaw?: unknown;
  pageCount: number;
  currentOffset: number;
}): CronPageMeta {
  const { totalRaw, limitRaw, offsetRaw, nextOffsetRaw, hasMoreRaw, pageCount, currentOffset } =
    params;
  const total =
    typeof totalRaw === "number" && Number.isFinite(totalRaw)
      ? Math.max(0, Math.floor(totalRaw))
      : currentOffset + pageCount;
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw)
      ? Math.max(1, Math.floor(limitRaw))
      : Math.max(1, pageCount);
  const offset =
    typeof offsetRaw === "number" && Number.isFinite(offsetRaw)
      ? Math.max(0, Math.floor(offsetRaw))
      : currentOffset;
  const hasMore =
    typeof hasMoreRaw === "boolean"
      ? hasMoreRaw
      : offset + pageCount < Math.max(total, offset + pageCount);
  const nextOffset =
    typeof nextOffsetRaw === "number" && Number.isFinite(nextOffsetRaw)
      ? Math.max(0, Math.floor(nextOffsetRaw))
      : hasMore
        ? offset + pageCount
        : null;
  return { total, limit, offset, hasMore, nextOffset };
}

const RUNS_ARRAY_KEYS = ["entries", "runs", "items", "list", "records", "rows"] as const;

/**
 * 解析 `cron.runs` 成功 payload 中的运行记录数组。
 */
export function extractCronRunsEntries(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) {
    return res.filter(
      (x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x),
    );
  }
  if (!res || typeof res !== "object") {
    return [];
  }
  const o = res as Record<string, unknown>;
  for (const key of RUNS_ARRAY_KEYS) {
    const raw = o[key];
    if (Array.isArray(raw)) {
      return raw.filter(
        (x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x),
      );
    }
  }
  for (const wrap of ["data", "result", "payload"] as const) {
    const inner = o[wrap];
    if (inner) {
      const nested = extractCronRunsEntries(inner);
      if (nested.length > 0) {
        return nested;
      }
    }
  }
  return [];
}
