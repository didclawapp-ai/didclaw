<script setup lang="ts">
import { extractCronRunsEntries, normalizeCronPageMeta } from "@/lib/cron-gateway";
import { describeGatewayError } from "@/lib/gateway-errors";
import { useGatewayStore } from "@/stores/gateway";
import { useSessionStore } from "@/stores/session";
import { computed, ref, watch } from "vue";

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [v: boolean];
}>();

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v),
});

const gw = useGatewayStore();
const sessions = useSessionStore();

type PanelTab = "list" | "create";
const panelTab = ref<PanelTab>("list");

const JOBS_PAGE_LIMIT = 50;
const RUNS_PAGE_LIMIT = 40;

const jobs = ref<Record<string, unknown>[]>([]);
const listError = ref<string | null>(null);
const listLoading = ref(false);
const jobsLoadingMore = ref(false);
const jobsTotal = ref(0);
const jobsHasMore = ref(false);
const jobsNextOffset = ref<number | null>(null);
const jobsSortBy = ref<"nextRunAtMs" | "updatedAtMs" | "name">("nextRunAtMs");
const jobsSortDir = ref<"asc" | "desc">("asc");

const cronStatus = ref<{
  enabled?: boolean;
  jobs?: number;
  nextWakeAtMs?: number | null;
} | null>(null);
const statusLoading = ref(false);

const runsScope = ref<"all" | "job">("all");
const runsJobId = ref<string | null>(null);
const runs = ref<Record<string, unknown>[]>([]);
const runsError = ref<string | null>(null);
const runsLoading = ref(false);
const runsLoadingMore = ref(false);
const runsTotal = ref(0);
const runsHasMore = ref(false);
const runsNextOffset = ref<number | null>(null);
const runsSortDir = ref<"asc" | "desc">("desc");

/** 调度：一次性 / 固定间隔 / Cron（与官方「调度」一致） */
const scheduleKind = ref<"at" | "every" | "cron">("every");
/** `datetime-local` 本地时间 → ISO */
const scheduleAtLocal = ref("");
const scheduleEveryValue = ref(30);
const scheduleEveryUnit = ref<"minutes" | "hours" | "days">("minutes");
const scheduleCronExpr = ref("0 9 * * *");
const scheduleCronTz = ref("");

const jobName = ref("");
const jobDescription = ref("");
/** 代理：`''` 默认，`'__custom__'` 使用下方自定义输入，否则为已选代理 id */
const jobAgentChoice = ref("");
const jobAgentCustom = ref("");
const createJobEnabled = ref(true);

/** 执行：主会话系统事件 vs 隔离助手轮次 */
const sessionTarget = ref<"main" | "isolated">("isolated");
const wakeMode = ref<"now" | "next-heartbeat">("next-heartbeat");
const systemEventText = ref("");
const agentMessage = ref("");
/** 留空则交由网关默认；用字符串避免 number 输入框空值异常 */
const timeoutSecondsInput = ref("");
/** 仅 scheduleKind === at */
const deleteAfterRun = ref(true);

/** 投递（隔离任务）；主会话任务不展示 */
const deliveryMode = ref<"none" | "announce">("announce");
const deliveryChannel = ref("last");
const deliveryTo = ref("");
const deliveryBestEffort = ref(true);

const createBusy = ref(false);
const createError = ref<string | null>(null);
const createOk = ref<string | null>(null);

const rowBusyId = ref<string | null>(null);

const connected = computed(() => gw.status === "connected" && !!gw.client?.connected);

/** 从 `sessions.list` 的 `agent:<id>:…` 键推断已出现过的代理 */
function agentIdFromSessionKey(key: string): string | null {
  const parts = key.split(":");
  if (parts.length >= 3 && parts[0] === "agent") {
    const id = parts[1]?.trim();
    return id || null;
  }
  return null;
}

const knownAgents = computed(() => {
  const map = new Map<string, string>();
  for (const s of sessions.sessions) {
    const id = agentIdFromSessionKey(s.key);
    if (!id) {
      continue;
    }
    if (!map.has(id)) {
      const lab = typeof s.label === "string" && s.label.trim() ? s.label.trim() : id;
      map.set(id, lab);
    }
  }
  if (map.size === 0) {
    map.set("main", "main");
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, label]) => ({ id, label }));
});

function resolveJobAgentIdForSubmit(): string {
  if (jobAgentChoice.value === "__custom__") {
    return jobAgentCustom.value.trim();
  }
  return jobAgentChoice.value.trim();
}

watch(jobAgentChoice, (c) => {
  if (c !== "__custom__") {
    jobAgentCustom.value = "";
  }
});

/**
 * 网关 `cron.list` 常见形态：
 * - 分页：`{ jobs, total, offset, limit, hasMore }`（OpenClaw main）
 * - 或直出数组 / `{ jobs: [] }`
 * 另：对 `jobs` 为「id → 任务」的对象做兼容；部分版本可能用 `rows` / `records` 或再包一层 `payload`。
 */
const CRON_LIST_ARRAY_KEYS = [
  "jobs",
  "items",
  "list",
  "entries",
  "rows",
  "records",
  "values",
] as const;

function isCronJobLike(x: unknown): boolean {
  if (!x || typeof x !== "object" || Array.isArray(x)) {
    return false;
  }
  const r = x as Record<string, unknown>;
  if (r.schedule && typeof r.schedule === "object" && !Array.isArray(r.schedule)) {
    return true;
  }
  if (typeof r.jobId === "string" && r.jobId.trim()) {
    return true;
  }
  if (typeof r.id === "string" && r.id.trim() && (r.name !== undefined || r.payload !== undefined)) {
    return true;
  }
  return false;
}

/** 结构化解析失败后，浅层扫描对象树中的「任务对象」数组（兼容未文档化的字段名）。 */
function extractJobsHeuristic(res: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4 || !res || typeof res !== "object") {
    return [];
  }
  const o = res as Record<string, unknown>;
  for (const v of Object.values(o)) {
    if (Array.isArray(v) && v.length > 0 && v.every(isCronJobLike)) {
      return v as Record<string, unknown>[];
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = extractJobsHeuristic(v, depth + 1);
      if (nested.length > 0) {
        return nested;
      }
    }
  }
  return [];
}

function extractJobs(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) {
    return res.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
  }
  if (!res || typeof res !== "object") {
    return [];
  }
  const o = res as Record<string, unknown>;
  for (const key of CRON_LIST_ARRAY_KEYS) {
    const raw = o[key];
    if (Array.isArray(raw)) {
      return raw.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const vals = Object.values(raw);
      if (
        vals.length > 0 &&
        vals.every((x) => x && typeof x === "object" && !Array.isArray(x))
      ) {
        return vals as Record<string, unknown>[];
      }
    }
  }
  const nestedCron = o.cron;
  if (nestedCron && typeof nestedCron === "object" && !Array.isArray(nestedCron)) {
    const fromCron = extractJobs(nestedCron);
    if (fromCron.length > 0) {
      return fromCron;
    }
  }
  for (const wrap of ["data", "result", "payload"] as const) {
    const inner = o[wrap];
    if (inner) {
      const nested = extractJobs(inner);
      if (nested.length > 0) {
        return nested;
      }
    }
  }
  return extractJobsHeuristic(res);
}

function jobIdOf(j: Record<string, unknown>): string {
  const id = typeof j.jobId === "string" && j.jobId.trim() ? j.jobId : j.id;
  return typeof id === "string" ? id : "";
}

function formatScheduleSummary(s: unknown): string {
  if (!s || typeof s !== "object") {
    return "—";
  }
  const sch = s as Record<string, unknown>;
  const kind = sch.kind;
  if (kind === "at" && typeof sch.at === "string") {
    return `一次性 ${sch.at}`;
  }
  if (kind === "every" && typeof sch.everyMs === "number") {
    const ms = sch.everyMs;
    if (ms % 86400000 === 0) {
      return `每 ${ms / 86400000} 天`;
    }
    if (ms % 3600000 === 0) {
      return `每 ${ms / 3600000} 小时`;
    }
    if (ms % 60000 === 0) {
      return `每 ${ms / 60000} 分钟`;
    }
    return `每 ${ms} ms`;
  }
  if (kind === "cron" && typeof sch.expr === "string") {
    const tz = typeof sch.tz === "string" && sch.tz.trim() ? ` (${sch.tz})` : "";
    return `Cron ${sch.expr}${tz}`;
  }
  try {
    return JSON.stringify(sch);
  } catch {
    return String(kind ?? "—");
  }
}

function isJobEnabled(j: Record<string, unknown>): boolean {
  return j.enabled !== false;
}

function formatMsLocal(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return "—";
  }
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function jobStateSummary(j: Record<string, unknown>): string {
  const st = j.state;
  if (!st || typeof st !== "object" || Array.isArray(st)) {
    return "—";
  }
  const s = st as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof s.lastStatus === "string" && s.lastStatus) {
    parts.push(`最近：${s.lastStatus}`);
  }
  if (typeof s.nextRunAtMs === "number") {
    parts.push(`下次 ${formatMsLocal(s.nextRunAtMs)}`);
  }
  if (typeof s.lastRunAtMs === "number") {
    parts.push(`上次 ${formatMsLocal(s.lastRunAtMs)}`);
  }
  return parts.length ? parts.join(" · ") : "—";
}

function runEntryTitle(r: Record<string, unknown>): string {
  const name = typeof r.jobName === "string" && r.jobName.trim() ? r.jobName.trim() : null;
  const id = typeof r.jobId === "string" && r.jobId.trim() ? r.jobId.trim() : "";
  return name ? `${name}（${id || "?"}）` : id || "—";
}

function runEntryStatus(r: Record<string, unknown>): string {
  const st = r.status;
  return typeof st === "string" && st ? st : "—";
}

function runEntrySummaryLine(r: Record<string, unknown>): string {
  if (typeof r.summary === "string" && r.summary.trim()) {
    return r.summary.trim();
  }
  if (typeof r.error === "string" && r.error.trim()) {
    return r.error.trim();
  }
  return "（无摘要）";
}

function runSessionKey(r: Record<string, unknown>): string {
  const k = r.sessionKey;
  return typeof k === "string" && k.trim() ? k.trim() : "";
}

function runDeliveryLabel(r: Record<string, unknown>): string {
  const d = r.deliveryStatus;
  return typeof d === "string" && d ? d : "—";
}

async function loadCronStatusOnly(): Promise<void> {
  const c = gw.client;
  if (!c?.connected) {
    cronStatus.value = null;
    return;
  }
  try {
    const res = await c.request<unknown>("cron.status", {});
    if (res && typeof res === "object" && !Array.isArray(res)) {
      cronStatus.value = res as {
        enabled?: boolean;
        jobs?: number;
        nextWakeAtMs?: number | null;
      };
    } else {
      cronStatus.value = null;
    }
  } catch {
    cronStatus.value = null;
  }
}

async function loadCronJobsPage(append: boolean): Promise<void> {
  const c = gw.client;
  if (!c?.connected) {
    jobs.value = [];
    jobsTotal.value = 0;
    jobsHasMore.value = false;
    jobsNextOffset.value = null;
    return;
  }
  const baseOffset = append ? Math.max(0, jobsNextOffset.value ?? jobs.value.length) : 0;
  if (append) {
    if (!jobsHasMore.value) {
      return;
    }
    jobsLoadingMore.value = true;
  } else {
    listLoading.value = true;
  }
  listError.value = null;
  try {
    let res: unknown;
    try {
      res = await c.request<unknown>("cron.list", {
        enabled: "all",
        includeDisabled: true,
        limit: JOBS_PAGE_LIMIT,
        offset: baseOffset,
        sortBy: jobsSortBy.value,
        sortDir: jobsSortDir.value,
      });
    } catch {
      res = await c.request<unknown>("cron.list", {
        enabled: "all",
        limit: 200,
        ...(baseOffset > 0 ? { offset: baseOffset } : {}),
      });
    }
    const pageJobs = extractJobs(res);
    jobs.value = append ? [...jobs.value, ...pageJobs] : pageJobs;
    if (res && typeof res === "object" && !Array.isArray(res)) {
      const o = res as Record<string, unknown>;
      const meta = normalizeCronPageMeta({
        totalRaw: o.total,
        limitRaw: o.limit,
        offsetRaw: o.offset,
        nextOffsetRaw: o.nextOffset,
        hasMoreRaw: o.hasMore,
        pageCount: pageJobs.length,
        currentOffset: baseOffset,
      });
      jobsTotal.value = Math.max(meta.total, jobs.value.length);
      jobsHasMore.value = meta.hasMore;
      jobsNextOffset.value = meta.nextOffset;
    } else {
      jobsTotal.value = jobs.value.length;
      jobsHasMore.value = false;
      jobsNextOffset.value = null;
    }
  } catch (e) {
    if (!append) {
      jobs.value = [];
      jobsTotal.value = 0;
      jobsHasMore.value = false;
      jobsNextOffset.value = null;
    }
    listError.value = describeGatewayError(e);
  } finally {
    if (append) {
      jobsLoadingMore.value = false;
    } else {
      listLoading.value = false;
    }
  }
}

async function loadMoreJobs(): Promise<void> {
  await loadCronJobsPage(true);
}

async function loadCronRuns(append: boolean): Promise<void> {
  const c = gw.client;
  if (!c?.connected) {
    runs.value = [];
    return;
  }
  const scope = runsScope.value;
  const activeId = runsJobId.value?.trim() || null;
  if (scope === "job" && !activeId) {
    runs.value = [];
    runsTotal.value = 0;
    runsHasMore.value = false;
    runsNextOffset.value = null;
    return;
  }
  if (append && !runsHasMore.value) {
    return;
  }
  const offset = append ? Math.max(0, runsNextOffset.value ?? runs.value.length) : 0;
  if (append) {
    runsLoadingMore.value = true;
  } else {
    runsLoading.value = true;
  }
  runsError.value = null;
  try {
    const res = await c.request<unknown>("cron.runs", {
      scope,
      id: scope === "job" ? activeId ?? undefined : undefined,
      limit: RUNS_PAGE_LIMIT,
      offset,
      sortDir: runsSortDir.value,
    });
    const entries = extractCronRunsEntries(res);
    const sameJob =
      scope === "all" || (activeId != null && runsJobId.value != null && runsJobId.value === activeId);
    runs.value = append && sameJob ? [...runs.value, ...entries] : entries;
    if (res && typeof res === "object" && !Array.isArray(res)) {
      const o = res as Record<string, unknown>;
      const meta = normalizeCronPageMeta({
        totalRaw: o.total,
        limitRaw: o.limit,
        offsetRaw: o.offset,
        nextOffsetRaw: o.nextOffset,
        hasMoreRaw: o.hasMore,
        pageCount: entries.length,
        currentOffset: offset,
      });
      runsTotal.value = Math.max(meta.total, runs.value.length);
      runsHasMore.value = meta.hasMore;
      runsNextOffset.value = meta.nextOffset;
    } else {
      runsTotal.value = runs.value.length;
      runsHasMore.value = false;
      runsNextOffset.value = null;
    }
  } catch (e) {
    if (!append) {
      runs.value = [];
      runsTotal.value = 0;
      runsHasMore.value = false;
      runsNextOffset.value = null;
    }
    runsError.value = describeGatewayError(e);
  } finally {
    if (append) {
      runsLoadingMore.value = false;
    } else {
      runsLoading.value = false;
    }
  }
}

async function loadMoreRuns(): Promise<void> {
  await loadCronRuns(true);
}

async function refreshOverview(): Promise<void> {
  const c = gw.client;
  if (!c?.connected) {
    jobs.value = [];
    cronStatus.value = null;
    runs.value = [];
    return;
  }
  listError.value = null;
  runsError.value = null;
  statusLoading.value = true;
  await loadCronStatusOnly();
  statusLoading.value = false;
  await loadCronJobsPage(false);
  await loadCronRuns(false);
}

async function refreshList(): Promise<void> {
  await refreshOverview();
}

function onJobsSortChange(): void {
  if (!connected.value) {
    return;
  }
  void loadCronJobsPage(false).then(() => {
    void loadCronRuns(false);
  });
}

function onRunsFiltersChange(): void {
  if (!connected.value) {
    return;
  }
  void loadCronRuns(false);
}

function onRunsJobSelect(event: Event): void {
  const el = event.target as HTMLSelectElement;
  runsJobId.value = el.value.trim() || null;
  onRunsFiltersChange();
}

function selectJobForRuns(jobId: string): void {
  if (!jobId) {
    return;
  }
  runsScope.value = "job";
  runsJobId.value = jobId;
  if (connected.value) {
    void loadCronRuns(false);
  }
}

async function openRunInChat(sessionKey: string): Promise<void> {
  const k = sessionKey.trim();
  if (!k) {
    return;
  }
  await sessions.selectSession(k);
  open.value = false;
}

watch(
  () => open.value,
  (v) => {
    if (v) {
      createError.value = null;
      createOk.value = null;
      void refreshOverview();
      if (gw.client?.connected) {
        void sessions.refresh();
      }
    }
  },
);

watch(
  () => gw.status,
  (s) => {
    if (open.value && s === "connected") {
      void refreshOverview();
      void sessions.refresh();
    }
  },
);


function buildSchedule():
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number }
  | { kind: "cron"; expr: string; tz?: string }
  | null {
  if (scheduleKind.value === "at") {
    if (!scheduleAtLocal.value) {
      return null;
    }
    const at = new Date(scheduleAtLocal.value);
    if (Number.isNaN(at.getTime())) {
      return null;
    }
    return { kind: "at", at: at.toISOString() };
  }
  if (scheduleKind.value === "every") {
    return { kind: "every", everyMs: everyMsFromForm() };
  }
  const expr = scheduleCronExpr.value.trim();
  if (!expr) {
    return null;
  }
  return {
    kind: "cron",
    expr,
    ...(scheduleCronTz.value.trim() ? { tz: scheduleCronTz.value.trim() } : {}),
  };
}

function everyMsFromForm(): number {
  const n = Math.max(1, Math.floor(Number(scheduleEveryValue.value)) || 1);
  switch (scheduleEveryUnit.value) {
    case "minutes":
      return n * 60_000;
    case "hours":
      return n * 3_600_000;
    case "days":
      return n * 86_400_000;
    default:
      return n * 60_000;
  }
}

async function submitCreate(): Promise<void> {
  createError.value = null;
  createOk.value = null;
  const c = gw.client;
  if (!c?.connected) {
    createError.value = "请先连接网关。";
    return;
  }
  if (!jobName.value.trim()) {
    createError.value = "请填写任务名称。";
    return;
  }
  if (jobAgentChoice.value === "__custom__" && !jobAgentCustom.value.trim()) {
    createError.value = "已选择「自定义 ID…」时请填写代理 ID，或改选默认/列表中的代理。";
    return;
  }
  const schedule = buildSchedule();
  if (!schedule) {
    if (scheduleKind.value === "at") {
      createError.value = scheduleAtLocal.value ? "执行时间无效。" : "请选择执行时间。";
    } else {
      createError.value = "请填写 Cron 表达式（五段）。";
    }
    return;
  }
  if (sessionTarget.value === "main") {
    if (!systemEventText.value.trim()) {
      createError.value = "主会话任务请填写系统事件内容。";
      return;
    }
  } else if (!agentMessage.value.trim()) {
    createError.value = "隔离任务请填写助手任务提示。";
    return;
  }
  const tRaw = timeoutSecondsInput.value.trim();
  if (tRaw) {
    const t = Math.floor(Number(tRaw));
    if (!Number.isFinite(t) || t <= 0) {
      createError.value = "超时（秒）须为正整数，或留空。";
      return;
    }
  }

  createBusy.value = true;
  try {
    const body: Record<string, unknown> = {
      name: jobName.value.trim(),
      enabled: createJobEnabled.value,
      schedule,
      sessionTarget: sessionTarget.value,
      wakeMode: wakeMode.value,
    };
    const desc = jobDescription.value.trim();
    if (desc) {
      body.description = desc;
    }
    const aid = resolveJobAgentIdForSubmit();
    if (aid) {
      body.agentId = aid;
    }
    if (sessionTarget.value === "main") {
      body.payload = { kind: "systemEvent", text: systemEventText.value.trim() };
    } else {
      const p: Record<string, unknown> = {
        kind: "agentTurn",
        message: agentMessage.value.trim(),
      };
      if (tRaw) {
        p.timeoutSeconds = Math.floor(Number(tRaw));
      }
      body.payload = p;
    }
    if (schedule.kind === "at") {
      body.deleteAfterRun = deleteAfterRun.value;
    }
    if (sessionTarget.value === "isolated") {
      if (deliveryMode.value === "none") {
        body.delivery = { mode: "none" };
      } else {
        const d: Record<string, unknown> = { mode: "announce" };
        const ch = deliveryChannel.value.trim();
        if (ch) {
          d.channel = ch;
        }
        const to = deliveryTo.value.trim();
        if (to) {
          d.to = to;
        }
        if (deliveryBestEffort.value) {
          d.bestEffort = true;
        }
        body.delivery = d;
      }
    }

    await c.request("cron.add", body);
    createOk.value = "任务已创建。";
    await refreshOverview();
    panelTab.value = "list";
  } catch (e) {
    createError.value = describeGatewayError(e);
  } finally {
    createBusy.value = false;
  }
}

async function runJobNow(jobId: string): Promise<void> {
  const c = gw.client;
  if (!c?.connected || !jobId) {
    return;
  }
  rowBusyId.value = jobId;
  listError.value = null;
  try {
    await c.request("cron.run", { id: jobId, mode: "force" });
    await refreshOverview();
  } catch (e) {
    listError.value = describeGatewayError(e);
  } finally {
    rowBusyId.value = null;
  }
}

async function toggleEnabled(j: Record<string, unknown>): Promise<void> {
  const jobId = jobIdOf(j);
  const c = gw.client;
  if (!c?.connected || !jobId) {
    return;
  }
  const next = !isJobEnabled(j);
  rowBusyId.value = jobId;
  listError.value = null;
  try {
    await c.request("cron.update", { id: jobId, patch: { enabled: next } });
    await refreshOverview();
  } catch (e) {
    listError.value = describeGatewayError(e);
  } finally {
    rowBusyId.value = null;
  }
}

async function removeJob(jobId: string): Promise<void> {
  if (!jobId) {
    return;
  }
  if (!window.confirm(`确定删除定时任务？\n${jobId}`)) {
    return;
  }
  const c = gw.client;
  if (!c?.connected) {
    return;
  }
  rowBusyId.value = jobId;
  listError.value = null;
  try {
    await c.request("cron.remove", { id: jobId });
    await refreshOverview();
  } catch (e) {
    listError.value = describeGatewayError(e);
  } finally {
    rowBusyId.value = null;
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="cron-backdrop" @click.self="open = false">
      <div
        class="cron-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cron-dialog-title"
        tabindex="-1"
      >
        <div class="cron-head">
          <h2 id="cron-dialog-title">定时任务</h2>
          <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm cron-close" @click="open = false">
            关闭
          </button>
        </div>

        <p class="cron-lead muted small">
          由<strong>当前已连接的 Gateway</strong> 调度；任务文件在该网关进程所在机器的用户目录下
          <code>~/.openclaw/cron/</code>（Windows 多为
          <code>%USERPROFILE%\.openclaw\cron\</code>）。网关需保持运行。若任务为一次性且勾选「运行成功后删除」，执行成功后会从列表消失，属正常。
          <strong>DidClaw 客户端的 SQLite</strong>（本机配置/KV）<strong>不参与</strong>定时任务存储；摘要来自
          <code>cron.status</code>，任务来自 <code>cron.list</code>，下方运行记录来自 <code>cron.runs</code>（与官方 Control UI 一致）。聊天里出现的「提醒」若未持久化为 cron 任务，列表可能仍为空。
          详见
          <a
            href="https://docs.openclaw.ai/zh-CN/automation/cron-jobs"
            target="_blank"
            rel="noreferrer"
          >OpenClaw 定时任务文档</a>。
        </p>

        <nav class="cron-tabs" role="tablist" aria-label="定时任务">
          <button
            type="button"
            role="tab"
            class="cron-tab"
            :class="{ active: panelTab === 'list' }"
            :aria-selected="panelTab === 'list'"
            @click="panelTab = 'list'"
          >
            已有任务
          </button>
          <button
            type="button"
            role="tab"
            class="cron-tab"
            :class="{ active: panelTab === 'create' }"
            :aria-selected="panelTab === 'create'"
            @click="panelTab = 'create'"
          >
            新建
          </button>
        </nav>

        <div v-if="!connected" class="cron-offline muted small">
          请先连接网关后再管理定时任务。
        </div>

        <div v-else-if="panelTab === 'list'" class="cron-body" role="tabpanel">
          <section class="cron-status-strip muted small" aria-label="调度器状态">
            <div class="cron-status-item">
              <span class="cron-status-label">调度器</span>
              <span class="cron-status-value">{{
                cronStatus == null
                  ? statusLoading
                    ? "…"
                    : "—"
                  : cronStatus.enabled === false
                    ? "已关闭"
                    : "运行中"
              }}</span>
            </div>
            <div class="cron-status-item">
              <span class="cron-status-label">任务数（网关）</span>
              <span class="cron-status-value">{{
                cronStatus != null && typeof cronStatus.jobs === "number" ? cronStatus.jobs : "—"
              }}</span>
            </div>
            <div class="cron-status-item cron-status-item--wide">
              <span class="cron-status-label">下次唤醒</span>
              <span class="cron-status-value" :title="formatMsLocal(cronStatus?.nextWakeAtMs ?? undefined)">{{
                formatMsLocal(cronStatus?.nextWakeAtMs ?? undefined)
              }}</span>
            </div>
          </section>

          <div class="cron-toolbar cron-toolbar-row">
            <button
              type="button"
              class="lc-btn lc-btn-ghost lc-btn-sm"
              :disabled="listLoading || statusLoading"
              @click="refreshList"
            >
              {{ listLoading || statusLoading ? "刷新中…" : "刷新" }}
            </button>
            <label class="cron-toolbar-field muted small">
              <span>排序字段</span>
              <select v-model="jobsSortBy" class="cron-select cron-select-compact" @change="onJobsSortChange">
                <option value="nextRunAtMs">下次运行</option>
                <option value="updatedAtMs">最近更新</option>
                <option value="name">名称</option>
              </select>
            </label>
            <label class="cron-toolbar-field muted small">
              <span>顺序</span>
              <select v-model="jobsSortDir" class="cron-select cron-select-compact" @change="onJobsSortChange">
                <option value="asc">升序</option>
                <option value="desc">降序</option>
              </select>
            </label>
            <span v-if="jobs.length || jobsTotal > 0" class="muted small cron-toolbar-meta">
              已加载 {{ jobs.length }} / 总计约 {{ jobsTotal }}
            </span>
          </div>
          <p v-if="listError" class="err small">{{ listError }}</p>
          <p v-if="!listLoading && !jobs.length && !listError" class="muted small">
            暂无任务。切换到「新建」添加任务（一次性或周期调度 + 执行方式 + 可选投递）。下方可查看
            <code>cron.runs</code>
            运行记录。若曾创建<strong>一次性且运行成功后删除</strong>的任务，执行成功后条目会消失。
          </p>
          <div v-if="jobs.length" class="cron-table-wrap">
            <table class="cron-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>调度</th>
                  <th>启用</th>
                  <th>运行态</th>
                  <th class="cron-th-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(j, idx) in jobs" :key="jobIdOf(j) || `row-${idx}`">
                  <td>
                    <div class="cron-name">{{ typeof j.name === "string" ? j.name : "—" }}</div>
                    <code class="cron-id">{{ jobIdOf(j) || "—" }}</code>
                  </td>
                  <td class="cron-sched">{{ formatScheduleSummary(j.schedule) }}</td>
                  <td>{{ isJobEnabled(j) ? "启用" : "暂停" }}</td>
                  <td class="cron-sched">{{ jobStateSummary(j) }}</td>
                  <td class="cron-actions">
                    <button
                      type="button"
                      class="lc-btn lc-btn-ghost lc-btn-xs"
                      :disabled="!jobIdOf(j) || rowBusyId === jobIdOf(j)"
                      @click="selectJobForRuns(jobIdOf(j))"
                    >
                      运行记录
                    </button>
                    <button
                      type="button"
                      class="lc-btn lc-btn-ghost lc-btn-xs"
                      :disabled="!jobIdOf(j) || rowBusyId === jobIdOf(j)"
                      @click="runJobNow(jobIdOf(j))"
                    >
                      立即运行
                    </button>
                    <button
                      type="button"
                      class="lc-btn lc-btn-ghost lc-btn-xs"
                      :disabled="!jobIdOf(j) || rowBusyId === jobIdOf(j)"
                      @click="toggleEnabled(j)"
                    >
                      {{ isJobEnabled(j) ? "暂停" : "启用" }}
                    </button>
                    <button
                      type="button"
                      class="lc-btn lc-btn-ghost lc-btn-xs"
                      :disabled="!jobIdOf(j) || rowBusyId === jobIdOf(j)"
                      @click="removeJob(jobIdOf(j))"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="jobsHasMore" class="cron-load-more">
            <button
              type="button"
              class="lc-btn lc-btn-ghost lc-btn-sm"
              :disabled="jobsLoadingMore"
              @click="loadMoreJobs"
            >
              {{ jobsLoadingMore ? "加载中…" : "加载更多任务" }}
            </button>
          </div>

          <fieldset class="cron-fieldset cron-runs-fieldset">
            <legend class="cron-legend">运行记录</legend>
            <p class="cron-section-desc muted small">
              网关 <code>cron.runs</code>；可选查看全部任务或单一任务的历次执行（与官方 Control UI 同源）。
            </p>
            <div class="cron-runs-toolbar">
              <label class="cron-field cron-field-inline cron-runs-field">
                <span class="cron-label">范围</span>
                <select
                  v-model="runsScope"
                  class="cron-select cron-select-compact"
                  @change="onRunsFiltersChange"
                >
                  <option value="all">全部任务</option>
                  <option value="job">指定任务</option>
                </select>
              </label>
              <label class="cron-field cron-field-inline cron-runs-field cron-runs-field-grow">
                <span class="cron-label">任务</span>
                <select
                  class="cron-select"
                  :disabled="runsScope !== 'job'"
                  :value="runsJobId ?? ''"
                  @change="onRunsJobSelect"
                >
                  <option value="">选择任务…</option>
                  <option v-for="(j, idx) in jobs" :key="jobIdOf(j) || `opt-${idx}`" :value="jobIdOf(j)">
                    {{ typeof j.name === 'string' ? j.name : jobIdOf(j) || '—' }}
                  </option>
                </select>
              </label>
              <label class="cron-field cron-field-inline cron-runs-field">
                <span class="cron-label">时间顺序</span>
                <select
                  v-model="runsSortDir"
                  class="cron-select cron-select-compact"
                  @change="onRunsFiltersChange"
                >
                  <option value="desc">新的在前</option>
                  <option value="asc">旧的在前</option>
                </select>
              </label>
            </div>
            <p v-if="runsError" class="err small">{{ runsError }}</p>
            <p
              v-if="runsScope === 'job' && !runsJobId && !runsLoading"
              class="muted small"
            >
              请选择上方任务，或点击表格中的「运行记录」。
            </p>
            <p v-else-if="runsLoading" class="muted small">运行记录加载中…</p>
            <p v-else-if="!runs.length && !runsError" class="muted small">暂无匹配的运行记录。</p>
            <ul v-else class="cron-run-list">
              <li v-for="(r, ridx) in runs" :key="ridx" class="cron-run-entry">
                <div class="cron-run-entry__head">
                  <span class="cron-run-entry__title">{{ runEntryTitle(r) }}</span>
                  <span class="muted cron-run-entry__status">{{ runEntryStatus(r) }}</span>
                </div>
                <div class="cron-run-entry__summary muted small">{{ runEntrySummaryLine(r) }}</div>
                <div class="cron-run-entry__meta muted small">
                  <span>{{ formatMsLocal(r.ts) }}</span>
                  <span v-if="typeof r.durationMs === 'number'"> · {{ r.durationMs }}ms</span>
                  <span> · 投递 {{ runDeliveryLabel(r) }}</span>
                  <span v-if="typeof r.model === 'string' && r.model"> · {{ r.model }}</span>
                </div>
                <div v-if="runSessionKey(r)" class="cron-run-entry__actions">
                  <button
                    type="button"
                    class="lc-btn lc-btn-ghost lc-btn-xs"
                    @click="openRunInChat(runSessionKey(r))"
                  >
                    打开会话
                  </button>
                </div>
              </li>
            </ul>
            <div v-if="runsHasMore && (runsScope === 'all' || runsJobId)" class="cron-load-more">
              <button
                type="button"
                class="lc-btn lc-btn-ghost lc-btn-sm"
                :disabled="runsLoadingMore"
                @click="loadMoreRuns"
              >
                {{ runsLoadingMore ? "加载中…" : "加载更多记录" }}
              </button>
              <span class="muted small cron-runs-total">已加载 {{ runs.length }} / 约 {{ runsTotal }}</span>
            </div>
          </fieldset>
        </div>

        <div v-else class="cron-body cron-create" role="tabpanel">
          <p class="muted small cron-section-note"><span class="cron-req">*</span> 必填</p>

          <fieldset class="cron-fieldset">
            <legend class="cron-legend">基本信息</legend>
            <p class="cron-section-desc muted small">命名、绑定智能体并设置启用状态。</p>
            <label class="cron-field">
              <span class="cron-label">名称 <span class="cron-req">*</span></span>
              <input v-model="jobName" type="text" class="cron-input" placeholder="例如：晨间简报" />
            </label>
            <label class="cron-field">
              <span class="cron-label">描述</span>
              <input
                v-model="jobDescription"
                type="text"
                class="cron-input"
                placeholder="此任务的可选说明"
              />
            </label>
            <label class="cron-field">
              <span class="cron-label">代理</span>
              <select v-model="jobAgentChoice" class="cron-select">
                <option value="">默认（网关默认智能体）</option>
                <option v-for="a in knownAgents" :key="a.id" :value="a.id">
                  {{ a.label === a.id ? a.id : `${a.label}（${a.id}）` }}
                </option>
                <option value="__custom__">自定义 ID…</option>
              </select>
              <input
                v-if="jobAgentChoice === '__custom__'"
                v-model="jobAgentCustom"
                type="text"
                class="cron-input cron-agent-custom-input"
                placeholder="输入代理 ID，如 ops"
              />
              <span class="muted small cron-field-hint">
                选项由当前已加载会话推断（会话键一般为 agent:代理ID:…）；无会话时至少含 main。未列出的代理请选「自定义」。
              </span>
            </label>
            <label class="cron-check">
              <input v-model="createJobEnabled" type="checkbox" />
              已启用
            </label>
          </fieldset>

          <fieldset class="cron-fieldset">
            <legend class="cron-legend">调度</legend>
            <p class="cron-section-desc muted small">选择一次性或周期规则。</p>
            <label class="cron-field">
              <span class="cron-label">调度类型 <span class="cron-req">*</span></span>
              <select v-model="scheduleKind" class="cron-select">
                <option value="at">一次性（指定日期时间）</option>
                <option value="every">每隔（固定间隔）</option>
                <option value="cron">Cron 表达式（五段）</option>
              </select>
            </label>
            <template v-if="scheduleKind === 'at'">
              <label class="cron-field">
                <span class="cron-label">执行时间（本地） <span class="cron-req">*</span></span>
                <input v-model="scheduleAtLocal" type="datetime-local" class="cron-input" />
              </label>
              <label class="cron-check">
                <input v-model="deleteAfterRun" type="checkbox" />
                运行成功后删除任务（一次性推荐开启）
              </label>
            </template>
            <div v-else-if="scheduleKind === 'every'" class="cron-row2">
              <label class="cron-field cron-field-inline">
                <span class="cron-label">每隔 <span class="cron-req">*</span></span>
                <input
                  v-model.number="scheduleEveryValue"
                  type="number"
                  min="1"
                  class="cron-input cron-input-narrow"
                />
              </label>
              <label class="cron-field cron-field-inline cron-field-grow">
                <span class="cron-label">单位</span>
                <select v-model="scheduleEveryUnit" class="cron-select">
                  <option value="minutes">分钟</option>
                  <option value="hours">小时</option>
                  <option value="days">天</option>
                </select>
              </label>
            </div>
            <template v-else>
              <label class="cron-field">
                <span class="cron-label">Cron 表达式 <span class="cron-req">*</span></span>
                <input
                  v-model="scheduleCronExpr"
                  type="text"
                  class="cron-input cron-mono"
                  placeholder="0 9 * * *"
                />
              </label>
              <label class="cron-field">
                <span class="cron-label">时区（可选，IANA）</span>
                <input
                  v-model="scheduleCronTz"
                  type="text"
                  class="cron-input"
                  placeholder="留空则使用网关主机本地时区"
                />
              </label>
            </template>
          </fieldset>

          <fieldset class="cron-fieldset">
            <legend class="cron-legend">执行</legend>
            <p class="cron-section-desc muted small">时间到达后的运行方式与内容。</p>
            <label class="cron-field">
              <span class="cron-label">会话 <span class="cron-req">*</span></span>
              <select v-model="sessionTarget" class="cron-select">
                <option value="main">主会话（写入主聊天时间线 · 系统事件）</option>
                <option value="isolated">隔离会话（cron: 独立轮次，与主时间线分离）</option>
              </select>
              <span class="muted small cron-field-hint">
                与
                <a
                  href="https://docs.openclaw.ai/automation/cron-jobs"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="cron-doc-link"
                  >官方定时任务说明</a>
                一致：<strong>主会话</strong>把 <code>systemEvent</code> 排进主会话，在下一次心跳用主上下文处理，适合要在<strong>当前聊天窗</strong>里延续的对话；
                <strong>隔离</strong>在 <code>cron:&lt;jobId&gt;</code> 会话单独跑一轮（见
                <a
                  href="https://docs.openclaw.ai/concepts/session"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="cron-doc-link"
                  >Session</a>
                ），主列表里需切换到对应会话才看得到全文；若开「投递 → 发布摘要」，可向渠道发摘要并在主会话出现短摘要（视网关与
                <code>wakeMode</code>）。
              </span>
            </label>
            <label class="cron-field">
              <span class="cron-label">唤醒模式</span>
              <select v-model="wakeMode" class="cron-select">
                <option value="now">立即</option>
                <option value="next-heartbeat">下次心跳</option>
              </select>
              <span class="muted small cron-field-hint">立即模式尽快触发；下次心跳则对齐心跳周期。</span>
            </label>
            <template v-if="sessionTarget === 'main'">
              <label class="cron-field">
                <span class="cron-label">系统事件内容 <span class="cron-req">*</span></span>
                <textarea
                  v-model="systemEventText"
                  class="cron-textarea"
                  rows="4"
                  placeholder="入队到主会话的 systemEvent 文本"
                />
              </label>
            </template>
            <template v-else>
              <label class="cron-field">
                <span class="cron-label">助手任务提示 <span class="cron-req">*</span></span>
                <textarea
                  v-model="agentMessage"
                  class="cron-textarea"
                  rows="4"
                  placeholder="在隔离会话中作为用户提示启动助手运行"
                />
              </label>
              <label class="cron-field">
                <span class="cron-label">超时（秒）</span>
                <input
                  v-model="timeoutSecondsInput"
                  type="text"
                  inputmode="numeric"
                  class="cron-input cron-input-narrow"
                  placeholder="可选，如 90"
                />
                <span class="muted small cron-field-hint">留空则使用网关默认超时。</span>
              </label>
            </template>
          </fieldset>

          <fieldset v-if="sessionTarget === 'isolated'" class="cron-fieldset">
            <legend class="cron-legend">投递</legend>
            <p class="cron-section-desc muted small">运行结束后是否将摘要发到渠道。</p>
            <label class="cron-field">
              <span class="cron-label">结果投递</span>
              <select v-model="deliveryMode" class="cron-select">
                <option value="announce">发布摘要（发到聊天 / 渠道）</option>
                <option value="none">不投递（仅内部执行）</option>
              </select>
              <span class="muted small cron-field-hint">
                发布摘要将尝试发到所选渠道；不投递则不做对外推送。
              </span>
            </label>
            <template v-if="deliveryMode === 'announce'">
              <label class="cron-field">
                <span class="cron-label">频道</span>
                <select v-model="deliveryChannel" class="cron-select">
                  <option value="last">last（最后路由）</option>
                  <option value="slack">Slack</option>
                  <option value="telegram">Telegram</option>
                  <option value="discord">Discord</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="signal">Signal</option>
                  <option value="imessage">iMessage</option>
                  <option value="mattermost">Mattermost</option>
                </select>
              </label>
              <label class="cron-field">
                <span class="cron-label">收件人 / 目标</span>
                <input
                  v-model="deliveryTo"
                  type="text"
                  class="cron-input"
                  placeholder="可选：channel:…、聊天 ID、电话等"
                />
                <span class="muted small cron-field-hint">留空时可回退到最后活跃路由（视网关配置而定）。</span>
              </label>
              <label class="cron-check">
                <input v-model="deliveryBestEffort" type="checkbox" />
                投递失败时不使任务失败（bestEffort）
              </label>
            </template>
          </fieldset>

          <p v-if="createError" class="err small">{{ createError }}</p>
          <p v-if="createOk" class="cron-ok small">{{ createOk }}</p>
          <div class="cron-create-actions">
            <button
              type="button"
              class="lc-btn lc-btn-sm"
              :disabled="!connected || createBusy"
              @click="submitCreate"
            >
              {{ createBusy ? "提交中…" : "创建" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cron-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
}
.cron-panel {
  display: flex;
  flex-direction: column;
  width: min(960px, 100%);
  max-height: min(90vh, 960px);
  overflow: hidden;
  background: var(--lc-surface-panel);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  box-shadow: var(--lc-shadow-sm);
  padding: 18px 20px 22px;
  box-sizing: border-box;
}
.cron-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.cron-head h2 {
  margin: 0;
  font-size: 1.1rem;
}
.cron-lead {
  margin: 0 0 12px;
  line-height: 1.45;
}
.cron-lead code {
  font-size: 11px;
}
.cron-lead a {
  color: var(--lc-accent);
}
.cron-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.cron-tab {
  padding: 8px 14px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
  font-size: 13px;
  cursor: pointer;
  color: var(--lc-text-muted);
  font-family: inherit;
}
.cron-tab:hover {
  color: var(--lc-text);
}
.cron-tab.active {
  border-color: var(--lc-border-strong);
  color: var(--lc-text);
  font-weight: 600;
  background: var(--lc-bg-raised);
}
.cron-offline {
  margin-bottom: 8px;
}
.cron-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}
.cron-toolbar {
  margin-bottom: 10px;
}
.cron-toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px 16px;
}
.cron-toolbar-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}
.cron-toolbar-meta {
  align-self: center;
}
.cron-status-strip {
  display: grid;
  grid-template-columns: 1fr 1fr 2fr;
  gap: 10px 12px;
  padding: 10px 12px;
  margin-bottom: 12px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
  line-height: 1.35;
}
.cron-status-item {
  min-width: 0;
}
.cron-status-item--wide {
  grid-column: 1 / -1;
}
@media (min-width: 560px) {
  .cron-status-item--wide {
    grid-column: auto;
  }
}
.cron-status-label {
  display: block;
  font-size: 11px;
  color: var(--lc-text-muted);
  margin-bottom: 2px;
}
.cron-status-value {
  font-weight: 600;
  color: var(--lc-text);
  word-break: break-word;
}
.cron-select-compact {
  min-width: 7.5rem;
  max-width: 12rem;
}
.cron-load-more {
  margin: 10px 0 16px;
}
.cron-runs-fieldset {
  margin-top: 4px;
}
.cron-runs-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  align-items: flex-end;
  margin-bottom: 10px;
}
.cron-runs-field {
  margin-bottom: 0;
}
.cron-runs-field-grow {
  flex: 1 1 200px;
  min-width: 160px;
}
.cron-runs-total {
  margin-left: 10px;
}
.cron-run-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cron-run-entry {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  padding: 10px 12px;
  margin-bottom: 8px;
  background: var(--lc-bg-raised);
}
.cron-run-entry__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}
.cron-run-entry__title {
  font-weight: 600;
  font-size: 13px;
}
.cron-run-entry__status {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.cron-run-entry__summary {
  margin-top: 6px;
  line-height: 1.4;
  word-break: break-word;
}
.cron-run-entry__meta {
  margin-top: 6px;
  font-size: 11px;
}
.cron-run-entry__actions {
  margin-top: 8px;
}
.cron-table-wrap {
  overflow-x: auto;
}
.cron-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.cron-table th,
.cron-table td {
  border: 1px solid var(--lc-border);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}
.cron-table th {
  background: var(--lc-bg-elevated);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lc-text-muted);
}
.cron-th-actions {
  white-space: nowrap;
}
.cron-name {
  font-weight: 600;
  margin-bottom: 4px;
}
.cron-id {
  font-size: 11px;
  word-break: break-all;
  color: var(--lc-text-muted);
}
.cron-sched {
  font-size: 12px;
  max-width: 220px;
  word-break: break-word;
}
.cron-actions {
  white-space: normal;
}
.cron-actions .lc-btn {
  margin-right: 6px;
  margin-bottom: 4px;
}
.cron-section-note {
  margin: 0 0 10px;
}
.cron-req {
  color: var(--lc-error);
  font-weight: 600;
}
.cron-section-desc {
  margin: -4px 0 10px;
  line-height: 1.4;
}
.cron-field-hint {
  display: block;
  margin-top: 4px;
  line-height: 1.35;
}
.cron-doc-link {
  color: var(--lc-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.cron-doc-link:hover {
  opacity: 0.9;
}
.cron-field-grow {
  flex: 1 1 160px;
  min-width: 120px;
}
.cron-agent-custom-input {
  margin-top: 8px;
}
.cron-fieldset {
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  padding: 10px 12px;
  margin: 0 0 14px;
}
.cron-legend {
  font-size: 12px;
  padding: 0 6px;
  color: var(--lc-text-muted);
}
.cron-radio {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
  cursor: pointer;
}
.cron-radio:last-child {
  margin-bottom: 0;
}
.cron-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.cron-field-inline {
  flex: 0 0 auto;
  margin-bottom: 0;
}
.cron-label {
  font-size: 12px;
  color: var(--lc-text-muted);
}
.cron-input,
.cron-textarea,
.cron-select {
  font-size: 13px;
  padding: 8px 10px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-family: inherit;
  box-sizing: border-box;
}
.cron-input-narrow {
  width: 5rem;
}
.cron-mono {
  font-family: var(--lc-mono);
}
.cron-textarea {
  resize: vertical;
  min-height: 72px;
}
.cron-row2 {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 12px;
}
.cron-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 12px;
  cursor: pointer;
}
.cron-hint code {
  font-size: 11px;
}
.cron-create-actions {
  margin-top: 8px;
}
.cron-ok {
  color: var(--lc-accent);
}
.err {
  color: var(--lc-error);
}
.muted {
  color: var(--lc-text-muted);
}
.small {
  font-size: 12px;
}
</style>
