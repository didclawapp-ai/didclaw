<script setup lang="ts">
import { extractCronRunsEntries, normalizeCronPageMeta } from "@/lib/cron-gateway";
import { describeGatewayError } from "@/lib/gateway-errors";
import { useGatewayStore } from "@/stores/gateway";
import { useSessionStore } from "@/stores/session";
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

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

const { t } = useI18n();
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
type DeliveryChannel = "last" | "whatsapp" | "feishu" | "wecom";
const deliveryChannel = ref<DeliveryChannel>("last");
const deliveryTo = ref("");
const deliveryBestEffort = ref(true);

const deliveryChannelOptions = computed((): { value: DeliveryChannel; label: string }[] => [
  { value: "last", label: t("cron.deliveryChannelLast") },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "feishu", label: "Feishu" },
  { value: "wecom", label: "WeCom" },
]);

function deliveryChannelLabel(channel: DeliveryChannel): string {
  return deliveryChannelOptions.value.find((item) => item.value === channel)?.label ?? channel;
}

function inferDeliveryTargetFromSessionKey(sessionKey: string | null | undefined): {
  channel: DeliveryChannel;
  to: string;
} | null {
  if (!sessionKey) {
    return null;
  }
  const whatsappDirect = sessionKey.match(/^agent:[^:]+:whatsapp:direct:(.+)$/);
  if (whatsappDirect?.[1]) {
    return { channel: "whatsapp", to: whatsappDirect[1] };
  }
  const feishuDirect = sessionKey.match(/^agent:[^:]+:feishu:direct:(.+)$/);
  if (feishuDirect?.[1]) {
    return { channel: "feishu", to: feishuDirect[1] };
  }
  return null;
}

function applyDeliveryPrefillFromActiveSession(): void {
  const inferred = inferDeliveryTargetFromSessionKey(sessions.activeSessionKey);
  if (!inferred) {
    deliveryChannel.value = "last";
    deliveryTo.value = "";
    return;
  }
  deliveryChannel.value = inferred.channel;
  deliveryTo.value = inferred.to;
}

/** 选了具体频道（非 last/空）时，to 字段为必填 */
const deliveryToRequired = computed(
  () =>
    deliveryMode.value === "announce" &&
    deliveryChannel.value !== "last",
);

/** 根据所选频道返回对应的 to 字段占位提示 */
const deliveryToPlaceholder = computed((): string => {
  switch (deliveryChannel.value) {
    case "whatsapp": return t("cron.deliveryToPlaceholderWhatsapp");
    case "feishu": return t("cron.deliveryToPlaceholderFeishu");
    case "wecom": return t("cron.deliveryToPlaceholderWecom");
    default: return t("cron.deliveryToPlaceholder");
  }
});

const activeSessionDeliveryPrefill = computed(() => inferDeliveryTargetFromSessionKey(sessions.activeSessionKey));

const createBusy = ref(false);
const createError = ref<string | null>(null);
const createOk = ref<string | null>(null);
let createOkTimer: number | null = null;

function setCreateOk(msg: string): void {
  createOk.value = msg;
  if (createOkTimer !== null) clearTimeout(createOkTimer);
  createOkTimer = window.setTimeout(() => {
    createOk.value = null;
    createOkTimer = null;
  }, 8000);
}

function resetCreateForm(): void {
  jobName.value = "";
  jobDescription.value = "";
  jobAgentChoice.value = "";
  jobAgentCustom.value = "";
  createJobEnabled.value = true;
  scheduleKind.value = "every";
  scheduleAtLocal.value = "";
  scheduleEveryValue.value = 30;
  scheduleEveryUnit.value = "minutes";
  scheduleCronExpr.value = "0 9 * * *";
  scheduleCronTz.value = "";
  sessionTarget.value = "isolated";
  wakeMode.value = "next-heartbeat";
  systemEventText.value = "";
  agentMessage.value = "";
  timeoutSecondsInput.value = "";
  deleteAfterRun.value = true;
  deliveryMode.value = "announce";
  applyDeliveryPrefillFromActiveSession();
  deliveryBestEffort.value = true;
  quickSchedule.value = "daily";
  quickScheduleTime.value = "09:00";
  quickScheduleDay.value = 1;
  showAdvancedCreate.value = false;
  simpleNotify.value = true;
}

const rowBusyId = ref<string | null>(null);
const runsCollapsed = ref(true);

function jobCardClass(j: Record<string, unknown>): string {
  if (!isJobEnabled(j)) return "cron-job-card--disabled";
  const phase = jobRunPhaseLabel(j);
  if (phase === t("cron.jobPhaseRunning")) return "cron-job-card--running";
  if (phase === t("cron.jobPhaseDone")) return "cron-job-card--done";
  return "cron-job-card--pending";
}

function runCardClass(r: Record<string, unknown>): string {
  const st = runEntryStatus(r).toLowerCase();
  if (/^(ok|success|done|completed)$/.test(st)) return "cron-run-card--ok";
  if (/^(error|fail|failed|timeout)$/.test(st)) return "cron-run-card--error";
  if (/^(running|active|pending)$/.test(st)) return "cron-run-card--running";
  return "";
}

/** 快频选择 */
type QuickSchedule = "daily" | "weekly" | "monthly" | "once" | "custom";
const quickSchedule = ref<QuickSchedule>("daily");
const quickScheduleTime = ref("09:00");
const quickScheduleDay = ref(1);

const showAdvancedCreate = ref(false);
/** 简化版"投递"开关：true → announce，false → none */
const simpleNotify = ref(true);

const freqOptions = computed((): { value: QuickSchedule; label: string }[] => [
  { value: "daily", label: t("cron.freqDaily") },
  { value: "weekly", label: t("cron.freqWeekly") },
  { value: "monthly", label: t("cron.freqMonthly") },
  { value: "once", label: t("cron.freqOnce") },
  { value: "custom", label: t("cron.freqCustom") },
]);

const dowOptions = computed((): { value: number; label: string }[] => [
  { value: 1, label: t("cron.dowMon") },
  { value: 2, label: t("cron.dowTue") },
  { value: 3, label: t("cron.dowWed") },
  { value: 4, label: t("cron.dowThu") },
  { value: 5, label: t("cron.dowFri") },
  { value: 6, label: t("cron.dowSat") },
  { value: 0, label: t("cron.dowSun") },
]);

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

function parseFriendlyCron(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, , dow] = parts;
  const h = parseInt(hour, 10);
  const m = parseInt(min, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  if (min !== "*" && hour !== "*" && dom === "*" && dow === "*") {
    return t("cron.parsedCronDaily", { time: timeStr });
  }
  if (min !== "*" && hour !== "*" && dom === "*" && dow !== "*" && /^\d$/.test(dow)) {
    const dowNames = [
      t("cron.dowSun"), t("cron.dowMon"), t("cron.dowTue"),
      t("cron.dowWed"), t("cron.dowThu"), t("cron.dowFri"), t("cron.dowSat"),
    ];
    return t("cron.parsedCronWeekly", { dow: dowNames[parseInt(dow, 10)] ?? dow, time: timeStr });
  }
  if (min !== "*" && hour !== "*" && dom !== "*" && /^\d+$/.test(dom) && dow === "*") {
    return t("cron.parsedCronMonthly", { day: dom, time: timeStr });
  }
  return null;
}

function formatScheduleSummary(s: unknown): string {
  if (!s || typeof s !== "object") return "—";
  const sch = s as Record<string, unknown>;
  const kind = sch.kind;
  if (kind === "at" && typeof sch.at === "string") {
    try {
      const d = new Date(sch.at);
      return t("cron.schedOnce", { time: d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) });
    } catch {
      return t("cron.schedOnceRaw", { time: sch.at });
    }
  }
  if (kind === "every" && typeof sch.everyMs === "number") {
    const ms = sch.everyMs;
    if (ms % 86400000 === 0) return t("cron.schedEveryDay", { n: ms / 86400000 });
    if (ms % 3600000 === 0) return t("cron.schedEveryHour", { n: ms / 3600000 });
    if (ms % 60000 === 0) return t("cron.schedEveryMinute", { n: ms / 60000 });
    return t("cron.schedEveryMs", { n: ms });
  }
  if (kind === "cron" && typeof sch.expr === "string") {
    const friendly = parseFriendlyCron(sch.expr);
    if (friendly) return friendly;
    const tz = typeof sch.tz === "string" && sch.tz.trim() ? ` (${sch.tz})` : "";
    return `Cron: ${sch.expr}${tz}`;
  }
  try { return JSON.stringify(sch); } catch { return String(kind ?? "—"); }
}

function formatRelativeTime(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const past = diff < 0;
  if (abs < 60_000) return past ? t("cron.timeJustNow") : t("cron.timeSoon");
  if (abs < 3_600_000) {
    const mn = Math.round(abs / 60_000);
    return past ? t("cron.timeMinutesBefore", { n: mn }) : t("cron.timeMinutesAfter", { n: mn });
  }
  if (abs < 86_400_000) {
    const hr = Math.round(abs / 3_600_000);
    return past ? t("cron.timeHoursBefore", { n: hr }) : t("cron.timeHoursAfter", { n: hr });
  }
  const d = Math.round(abs / 86_400_000);
  if (d <= 14) return past ? t("cron.timeDaysBefore", { n: d }) : t("cron.timeDaysAfter", { n: d });
  try {
    return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return formatMsLocal(ms);
  }
}

function jobNextRunAtMs(j: Record<string, unknown>): number | null {
  const st = j.state;
  if (!st || typeof st !== "object" || Array.isArray(st)) return null;
  const s = st as Record<string, unknown>;
  return typeof s.nextRunAtMs === "number" && Number.isFinite(s.nextRunAtMs) ? s.nextRunAtMs : null;
}

/** 把快频 UI 的值同步到 scheduleKind / scheduleCronExpr / scheduleEveryUnit */
function syncQuickSchedule(): void {
  const parts = quickScheduleTime.value.split(":");
  const h = Math.max(0, Math.min(23, parseInt(parts[0] ?? "9", 10) || 0));
  const m = Math.max(0, Math.min(59, parseInt(parts[1] ?? "0", 10) || 0));
  switch (quickSchedule.value) {
    case "daily":
      scheduleKind.value = "cron";
      scheduleCronExpr.value = `${m} ${h} * * *`;
      break;
    case "weekly":
      scheduleKind.value = "cron";
      scheduleCronExpr.value = `${m} ${h} * * ${quickScheduleDay.value}`;
      break;
    case "monthly":
      scheduleKind.value = "cron";
      scheduleCronExpr.value = `${m} ${h} ${Math.max(1, Math.min(28, quickScheduleDay.value))} * *`;
      break;
    case "once":
      scheduleKind.value = "at";
      break;
    case "custom":
      scheduleKind.value = "every";
      break;
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

/** 悬停展示：最近结果、下次/上次时间（与网关 `CronJobState` 一致） */
function jobStateDetailTooltip(j: Record<string, unknown>): string {
  const st = j.state;
  if (!st || typeof st !== "object" || Array.isArray(st)) {
    return "";
  }
  const s = st as Record<string, unknown>;
  const parts: string[] = [];
  const lastOutcome =
    (typeof s.lastRunStatus === "string" && s.lastRunStatus.trim()) ||
    (typeof s.lastStatus === "string" && s.lastStatus.trim());
  if (lastOutcome) {
    parts.push(`${t("cron.jobPhaseDone")}：${lastOutcome}`);
  }
  if (typeof s.nextRunAtMs === "number") {
    parts.push(`${t("cron.statusNextWake")} ${formatMsLocal(s.nextRunAtMs)}`);
  }
  if (typeof s.lastRunAtMs === "number") {
    parts.push(`${t("cron.sortUpdated")} ${formatMsLocal(s.lastRunAtMs)}`);
  }
  return parts.length ? parts.join(" · ") : "";
}

/**
 * 列表「运行态」主文案：与 OpenClaw `runningAtMs` / `lastRunAtMs` / `lastStatus` 语义对齐。
 * - 运行中：网关已标记执行中
 * - 已运行：至少完成过一次执行（有上次时间或终端状态）
 * - 未运行：尚未执行过（可能仍在等待首次调度）
 */
function jobRunPhaseLabel(j: Record<string, unknown>): string {
  const st = j.state;
  if (!st || typeof st !== "object" || Array.isArray(st)) {
    return t("cron.jobPhasePending");
  }
  const s = st as Record<string, unknown>;
  if (typeof s.runningAtMs === "number" && Number.isFinite(s.runningAtMs)) {
    return t("cron.jobPhaseRunning");
  }
  const hasLastRun =
    (typeof s.lastRunAtMs === "number" && Number.isFinite(s.lastRunAtMs)) ||
    (typeof s.lastStatus === "string" && s.lastStatus.trim() !== "") ||
    (typeof s.lastRunStatus === "string" && s.lastRunStatus.trim() !== "");
  if (hasLastRun) {
    return t("cron.jobPhaseDone");
  }
  return t("cron.jobPhasePending");
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
  return t("cron.runNoSummary");
}

function runSessionKey(r: Record<string, unknown>): string {
  const k = r.sessionKey;
  return typeof k === "string" && k.trim() ? k.trim() : "";
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
  await Promise.all([loadCronStatusOnly(), loadCronJobsPage(false), loadCronRuns(false)]);
  statusLoading.value = false;
}

async function refreshList(): Promise<void> {
  await refreshOverview();
}

function onJobsSortChange(): void {
  if (!connected.value) {
    return;
  }
  void loadCronJobsPage(false);
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
    } else {
      if (createOkTimer !== null) {
        clearTimeout(createOkTimer);
        createOkTimer = null;
      }
    }
  },
);

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && open.value) {
    open.value = false;
  }
}

onUnmounted(() => {
  if (createOkTimer !== null) clearTimeout(createOkTimer);
  window.removeEventListener("keydown", onKeydown);
});

watch(
  () => open.value,
  (v) => {
    if (v) {
      window.addEventListener("keydown", onKeydown);
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
  { immediate: true },
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

watch([quickSchedule, quickScheduleTime, quickScheduleDay], () => {
  syncQuickSchedule();
}, { immediate: true });

watch(simpleNotify, (v) => {
  deliveryMode.value = v ? "announce" : "none";
}, { immediate: true });

watch(
  [open, panelTab],
  ([dialogOpen, tab], [prevOpen, prevTab]) => {
    const enteringCreate = dialogOpen && tab === "create" && (!prevOpen || prevTab !== "create");
    if (enteringCreate) {
      resetCreateForm();
    }
  },
  { immediate: false },
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
    createError.value = t("cron.errNoGateway");
    return;
  }
  if (!jobName.value.trim()) {
    createError.value = t("cron.errNoName");
    return;
  }
  if (jobAgentChoice.value === "__custom__" && !jobAgentCustom.value.trim()) {
    createError.value = t("cron.errNoCustomAgent");
    return;
  }
  const schedule = buildSchedule();
  if (!schedule) {
    if (scheduleKind.value === "at") {
      createError.value = scheduleAtLocal.value ? t("cron.errInvalidTime") : t("cron.errNoTime");
    } else {
      createError.value = t("cron.errNoCronExpr");
    }
    return;
  }
  if (sessionTarget.value === "main") {
    if (!systemEventText.value.trim()) {
      createError.value = t("cron.errNoSystemEvent");
      return;
    }
  } else if (!agentMessage.value.trim()) {
    createError.value = t("cron.errNoAgentMessage");
    return;
  }
  const tRaw = timeoutSecondsInput.value.trim();
  if (tRaw) {
    const tVal = Math.floor(Number(tRaw));
    if (!Number.isFinite(tVal) || tVal <= 0) {
      createError.value = t("cron.errInvalidTimeout");
      return;
    }
  }
  if (sessionTarget.value === "isolated" && deliveryToRequired.value && !deliveryTo.value.trim()) {
    createError.value = t("cron.errNoDeliveryTo", { channel: deliveryChannelLabel(deliveryChannel.value) });
    return;
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
    setCreateOk(t("cron.createOk"));
    resetCreateForm();
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
  if (!window.confirm(t("cron.jobDeleteConfirm", { id: jobId }))) {
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
          <h2 id="cron-dialog-title">{{ t('cron.dialogTitle') }}</h2>
          <button type="button" class="cron-close" :aria-label="t('cron.closeLabel')" @click="open = false">✕</button>
        </div>

        <p class="cron-lead muted small">
          {{ t('cron.lead') }}
          <a
            href="https://docs.openclaw.ai/zh-CN/automation/cron-jobs"
            target="_blank"
            rel="noreferrer"
          >{{ t('common.docs') }}</a>
        </p>

        <nav class="cron-tabs" role="tablist" :aria-label="t('cron.navLabel')">
          <button
            type="button"
            role="tab"
            class="cron-tab"
            :class="{ active: panelTab === 'list' }"
            :aria-selected="panelTab === 'list'"
            @click="panelTab = 'list'"
          >
            {{ t('cron.tabList') }}
          </button>
          <button
            type="button"
            role="tab"
            class="cron-tab"
            :class="{ active: panelTab === 'create' }"
            :aria-selected="panelTab === 'create'"
            @click="panelTab = 'create'"
          >
            {{ t('cron.tabCreate') }}
          </button>
        </nav>

        <div v-if="!connected" class="cron-offline muted small">
          {{ t('cron.offlineHint') }}
        </div>

        <div v-else-if="panelTab === 'list'" class="cron-body" role="tabpanel">

          <!-- 状态栏 -->
          <section class="cron-status-strip" :aria-label="t('cron.statusScheduler')">
            <div class="cron-status-item">
              <span class="cron-status-label">{{ t('cron.statusScheduler') }}</span>
              <span class="cron-status-value" :class="cronStatus?.enabled !== false ? 'cron-status--on' : 'cron-status--off'">
                {{ cronStatus == null ? (statusLoading ? "…" : "—") : cronStatus.enabled === false ? t('cron.schedulerOff') : t('cron.schedulerOn') }}
              </span>
            </div>
            <div class="cron-status-item">
              <span class="cron-status-label">{{ t('cron.statusJobs') }}</span>
              <span class="cron-status-value">{{ cronStatus != null && typeof cronStatus.jobs === "number" ? cronStatus.jobs : "—" }}</span>
            </div>
            <div class="cron-status-item">
              <span class="cron-status-label">{{ t('cron.statusNextWake') }}</span>
              <span class="cron-status-value cron-status-value--sm" :title="formatMsLocal(cronStatus?.nextWakeAtMs ?? undefined)">
                {{ cronStatus?.nextWakeAtMs ? formatRelativeTime(cronStatus.nextWakeAtMs) : "—" }}
              </span>
            </div>
          </section>

          <!-- 紧凑工具栏 -->
          <div class="cron-toolbar-compact">
            <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm"
              :disabled="listLoading || statusLoading" @click="refreshList">
              {{ listLoading || statusLoading ? t('common.refreshing') : t('common.refresh') }}
            </button>
            <span class="cron-toolbar-sep">|</span>
            <span class="muted small">{{ t('cron.sortLabel') }}</span>
            <select v-model="jobsSortBy" class="cron-select cron-select-xs" @change="onJobsSortChange">
              <option value="nextRunAtMs">{{ t('cron.sortNextRun') }}</option>
              <option value="updatedAtMs">{{ t('cron.sortUpdated') }}</option>
              <option value="name">{{ t('cron.sortName') }}</option>
            </select>
            <select v-model="jobsSortDir" class="cron-select cron-select-xs" @change="onJobsSortChange">
              <option value="asc">{{ t('cron.sortAsc') }}</option>
              <option value="desc">{{ t('cron.sortDesc') }}</option>
            </select>
            <span v-if="jobs.length || jobsTotal > 0" class="muted small" style="margin-left:auto">
              {{ t('cron.itemsCount', { shown: jobs.length, total: jobsTotal }) }}
            </span>
          </div>

          <p v-if="listError" class="err small">{{ listError }}</p>

          <!-- 空状态 -->
          <div v-if="!listLoading && !jobs.length && !listError" class="cron-empty-state">
            <div class="cron-empty-icon">⏰</div>
            <div class="cron-empty-title">{{ t('cron.emptyTitle') }}</div>
            <div class="cron-empty-desc muted small">{{ t('cron.emptyDesc') }}</div>
            <button type="button" class="lc-btn lc-btn-sm" style="margin-top:12px" @click="panelTab = 'create'">
              {{ t('cron.emptyCreate') }}
            </button>
          </div>

          <!-- 任务卡片列表 -->
          <div v-if="jobs.length" class="cron-job-list">
            <div v-for="(j, idx) in jobs" :key="jobIdOf(j) || `row-${idx}`"
              class="cron-job-card"
              :class="jobCardClass(j)"
              :title="jobStateDetailTooltip(j) || undefined">
              <div class="cron-job-card__head">
                <div class="cron-job-card__name">{{ typeof j.name === "string" ? j.name : t('cron.jobUnnamed') }}</div>
                <div class="cron-job-card__phase-badge" :class="'cron-job-card__phase-badge--' + jobCardClass(j).replace('cron-job-card--', '')">
                  {{ jobRunPhaseLabel(j) }}
                </div>
              </div>
              <div class="cron-job-card__meta">
                <span class="cron-job-card__sched">{{ formatScheduleSummary(j.schedule) }}</span>
                <span v-if="jobNextRunAtMs(j) !== null" class="muted" style="font-size:11px">
                  {{ t('cron.jobNextRun', { time: formatRelativeTime(jobNextRunAtMs(j)) }) }}
                </span>
                <span v-else-if="!isJobEnabled(j)" class="muted" style="font-size:11px">{{ t('cron.jobPaused') }}</span>
              </div>
              <div class="cron-job-card__actions">
                <button type="button" class="lc-btn lc-btn-ghost lc-btn-xs"
                  :disabled="!jobIdOf(j) || rowBusyId === jobIdOf(j)"
                  @click="selectJobForRuns(jobIdOf(j))">{{ t('cron.jobHistory') }}</button>
                <button type="button" class="lc-btn lc-btn-ghost lc-btn-xs"
                  :disabled="!jobIdOf(j) || rowBusyId === jobIdOf(j)"
                  @click="runJobNow(jobIdOf(j))">{{ t('cron.jobRunNow') }}</button>
                <button type="button" class="lc-btn lc-btn-ghost lc-btn-xs"
                  :disabled="!jobIdOf(j) || rowBusyId === jobIdOf(j)"
                  @click="toggleEnabled(j)">{{ isJobEnabled(j) ? t('cron.jobPause') : t('cron.jobResume') }}</button>
                <button type="button" class="lc-btn lc-btn-ghost lc-btn-xs btn-danger"
                  :disabled="!jobIdOf(j) || rowBusyId === jobIdOf(j)"
                  @click="removeJob(jobIdOf(j))">{{ t('cron.jobDelete') }}</button>
              </div>
            </div>
          </div>

          <div v-if="jobsHasMore" class="cron-load-more">
            <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm"
              :disabled="jobsLoadingMore" @click="loadMoreJobs">
              {{ jobsLoadingMore ? t('cron.loadingMore') : t('cron.loadMoreJobs') }}
            </button>
          </div>

          <!-- 执行历史（可折叠） -->
          <div class="cron-runs-section">
            <button type="button" class="cron-runs-header" @click="runsCollapsed = !runsCollapsed">
              <span class="cron-runs-header__title">{{ t('cron.runsTitle') }}</span>
              <span v-if="runs.length" class="muted small">{{ t('cron.runsCount', { count: runs.length }) }}</span>
              <span class="cron-runs-header__arrow">{{ runsCollapsed ? "▼" : "▲" }}</span>
            </button>

            <div v-if="!runsCollapsed" class="cron-runs-body">
              <!-- 筛选栏 -->
              <div class="cron-runs-filter-row">
                <select v-model="runsScope" class="cron-select cron-select-xs" @change="onRunsFiltersChange">
                  <option value="all">{{ t('cron.runsFilterAll') }}</option>
                  <option value="job">{{ t('cron.runsFilterJob') }}</option>
                </select>
                <select v-if="runsScope === 'job'" class="cron-select cron-select-sm"
                  :value="runsJobId ?? ''" @change="onRunsJobSelect">
                  <option value="">{{ t('cron.runsSelectJob') }}</option>
                  <option v-for="(j, jidx) in jobs" :key="jobIdOf(j) || `opt-${jidx}`" :value="jobIdOf(j)">
                    {{ typeof j.name === "string" ? j.name : jobIdOf(j) || "—" }}
                  </option>
                </select>
                <select v-model="runsSortDir" class="cron-select cron-select-xs" @change="onRunsFiltersChange">
                  <option value="desc">{{ t('cron.runsNewest') }}</option>
                  <option value="asc">{{ t('cron.runsOldest') }}</option>
                </select>
              </div>

              <p v-if="runsError" class="err small">{{ runsError }}</p>
              <p v-if="runsScope === 'job' && !runsJobId && !runsLoading" class="muted small">
                {{ t('cron.runsSelectHint') }}
              </p>
              <p v-else-if="runsLoading" class="muted small">{{ t('common.loading') }}</p>
              <p v-else-if="!runs.length && !runsError" class="muted small">{{ t('cron.runsEmpty') }}</p>

              <ul v-else class="cron-run-list">
                <li v-for="(r, ridx) in runs" :key="ridx" class="cron-run-entry" :class="runCardClass(r)">
                  <div class="cron-run-entry__head">
                    <span class="cron-run-entry__title">{{ runEntryTitle(r) }}</span>
                    <span class="cron-run-entry__status"
                      :class="{
                        'cron-run-status--ok': /^(ok|success|done|completed)$/i.test(runEntryStatus(r)),
                        'cron-run-status--err': /^(error|fail|failed|timeout)$/i.test(runEntryStatus(r)),
                        'cron-run-status--run': /^(running|active|pending)$/i.test(runEntryStatus(r)),
                      }">{{ runEntryStatus(r) }}</span>
                  </div>
                  <div class="cron-run-entry__summary muted small">{{ runEntrySummaryLine(r) }}</div>
                  <div class="cron-run-entry__meta muted small">
                    <span>{{ formatMsLocal(r.ts) }}</span>
                    <span v-if="typeof r.durationMs === 'number'"> · {{ r.durationMs }}ms</span>
                    <span v-if="typeof r.model === 'string' && r.model"> · {{ r.model }}</span>
                  </div>
                  <div v-if="runSessionKey(r)" class="cron-run-entry__actions">
                    <button type="button" class="lc-btn lc-btn-ghost lc-btn-xs"
                      @click="openRunInChat(runSessionKey(r))">{{ t('cron.runOpenSession') }}</button>
                  </div>
                </li>
              </ul>

              <div v-if="runsHasMore && (runsScope === 'all' || runsJobId)" class="cron-load-more">
                <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm"
                  :disabled="runsLoadingMore" @click="loadMoreRuns">
                  {{ runsLoadingMore ? t('cron.loadingMore') : t('cron.loadMoreRuns') }}
                </button>
                <span class="muted small" style="margin-left:8px">{{ runs.length }} / {{ runsTotal }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="cron-body cron-create" role="tabpanel">

          <!-- 任务名称 -->
          <div class="cron-create-card">
            <label class="cron-field" style="margin-bottom:0">
              <span class="cron-create-card-title">{{ t('cron.jobNameLabel') }} <span class="cron-req">{{ t('common.required') }}</span></span>
              <input
                v-model="jobName"
                type="text"
                class="cron-input cron-create-name-input"
                :placeholder="t('cron.jobNamePlaceholder')"
              />
            </label>
          </div>

          <!-- 执行频率 -->
          <div class="cron-create-card">
            <div class="cron-create-card-title">{{ t('cron.scheduleTitle') }}</div>
            <div class="cron-freq-pills">
              <button
                v-for="f in freqOptions"
                :key="f.value"
                type="button"
                :class="['cron-freq-pill', { active: quickSchedule === f.value }]"
                @click="quickSchedule = f.value"
              >{{ f.label }}</button>
            </div>

            <!-- 每天：选时间 -->
            <div v-if="quickSchedule === 'daily'" class="cron-schedule-detail">
              <label class="cron-field" style="margin-bottom:0">
                <span class="cron-label">{{ t('cron.schedTimeDailyLabel') }}</span>
                <input v-model="quickScheduleTime" type="time" class="cron-input cron-input-time" />
              </label>
            </div>

            <!-- 每周：选星期 + 时间 -->
            <div v-else-if="quickSchedule === 'weekly'" class="cron-schedule-detail">
              <div class="cron-field">
                <span class="cron-label">{{ t('cron.schedTimeWeeklyDow') }}</span>
                <div class="cron-dow-pills">
                  <button
                    v-for="d in dowOptions"
                    :key="d.value"
                    type="button"
                    :class="['cron-dow-pill', { active: quickScheduleDay === d.value }]"
                    @click="quickScheduleDay = d.value"
                  >{{ d.label }}</button>
                </div>
              </div>
              <label class="cron-field" style="margin-bottom:0">
                <span class="cron-label">{{ t('cron.schedTimeWeeklyTime') }}</span>
                <input v-model="quickScheduleTime" type="time" class="cron-input cron-input-time" />
              </label>
            </div>

            <!-- 每月：选几号 + 时间 -->
            <div v-else-if="quickSchedule === 'monthly'" class="cron-schedule-detail">
              <label class="cron-field">
                <span class="cron-label">{{ t('cron.schedTimeMonthlyDay') }}<span class="muted">{{ t('cron.schedTimeMonthlyDayHint') }}</span></span>
                <input v-model.number="quickScheduleDay" type="number" min="1" max="28" class="cron-input cron-input-narrow" />
              </label>
              <label class="cron-field" style="margin-bottom:0">
                <span class="cron-label">{{ t('cron.schedTimeMonthlyTime') }}</span>
                <input v-model="quickScheduleTime" type="time" class="cron-input cron-input-time" />
              </label>
            </div>

            <!-- 只运行一次 -->
            <div v-else-if="quickSchedule === 'once'" class="cron-schedule-detail">
              <label class="cron-field">
                <span class="cron-label">{{ t('cron.schedOnceTimeLabel') }} <span class="cron-req">{{ t('common.required') }}</span></span>
                <input v-model="scheduleAtLocal" type="datetime-local" class="cron-input" />
              </label>
              <label class="cron-check" style="margin-bottom:0">
                <input v-model="deleteAfterRun" type="checkbox" />
                {{ t('cron.schedOnceDeleteAfter') }}
              </label>
            </div>

            <!-- 自定义间隔 -->
            <div v-else-if="quickSchedule === 'custom'" class="cron-schedule-detail">
              <div class="cron-row2">
                <label class="cron-field cron-field-inline">
                  <span class="cron-label">{{ t('cron.schedCustomEveryLabel') }} <span class="cron-req">{{ t('common.required') }}</span></span>
                  <input v-model.number="scheduleEveryValue" type="number" min="1" class="cron-input cron-input-narrow" />
                </label>
                <label class="cron-field cron-field-inline cron-field-grow">
                  <span class="cron-label">{{ t('cron.schedCustomUnit') }}</span>
                  <select v-model="scheduleEveryUnit" class="cron-select">
                    <option value="minutes">{{ t('cron.schedUnitMinutes') }}</option>
                    <option value="hours">{{ t('cron.schedUnitHours') }}</option>
                    <option value="days">{{ t('cron.schedUnitDays') }}</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          <!-- 告诉 AI 要做什么 -->
          <div class="cron-create-card">
            <div class="cron-create-card-title">{{ t('cron.taskTitle') }} <span class="cron-req">{{ t('common.required') }}</span></div>
            <textarea
              v-model="agentMessage"
              class="cron-textarea cron-create-task-textarea"
              rows="4"
              :placeholder="t('cron.taskPlaceholder')"
            />
          </div>

          <!-- 通知 -->
          <label class="cron-check cron-create-notify">
            <input v-model="simpleNotify" type="checkbox" />
            <span>{{ t('cron.notifyLabel') }}</span>
          </label>

          <!-- 高级设置折叠 -->
          <button type="button" class="cron-advanced-toggle" @click="showAdvancedCreate = !showAdvancedCreate">
            <span class="cron-advanced-toggle-icon">{{ showAdvancedCreate ? '▲' : '▼' }}</span>
            {{ showAdvancedCreate ? t('cron.advancedToggleHide') : t('cron.advancedToggleShow') }}
          </button>

          <div v-if="showAdvancedCreate" class="cron-advanced-wrap">
            <fieldset class="cron-fieldset">
              <legend class="cron-legend">{{ t('cron.advancedTitle') }}</legend>
              <label class="cron-field">
                <span class="cron-label">{{ t('cron.descLabel') }}</span>
                <input v-model="jobDescription" type="text" class="cron-input" :placeholder="t('cron.descPlaceholder')" />
              </label>
              <label class="cron-field">
                <span class="cron-label">{{ t('cron.agentLabel') }}</span>
                <select v-model="jobAgentChoice" class="cron-select">
                  <option value="">{{ t('cron.agentDefault') }}</option>
                  <option v-for="a in knownAgents" :key="a.id" :value="a.id">
                    {{ a.label === a.id ? a.id : `${a.label}（${a.id}）` }}
                  </option>
                  <option value="__custom__">{{ t('cron.agentCustom') }}</option>
                </select>
                <input
                  v-if="jobAgentChoice === '__custom__'"
                  v-model="jobAgentCustom"
                  type="text"
                  class="cron-input cron-agent-custom-input"
                  :placeholder="t('cron.agentCustomPlaceholder')"
                />
              </label>
              <label class="cron-field">
                <span class="cron-label">{{ t('cron.sessionModeLabel') }}</span>
                <select v-model="sessionTarget" class="cron-select">
                  <option value="isolated">{{ t('cron.sessionIsolated') }}</option>
                  <option value="main">{{ t('cron.sessionMain') }}</option>
                </select>
              </label>
              <template v-if="sessionTarget === 'main'">
                <label class="cron-field">
                  <span class="cron-label">{{ t('cron.systemEventLabel') }} <span class="cron-req">{{ t('common.required') }}</span></span>
                  <textarea v-model="systemEventText" class="cron-textarea" rows="3"
                    :placeholder="t('cron.systemEventPlaceholder')" />
                </label>
              </template>
              <label class="cron-field">
                <span class="cron-label">{{ t('cron.timeoutLabel') }}</span>
                <input
                  v-model="timeoutSecondsInput"
                  type="text"
                  inputmode="numeric"
                  class="cron-input cron-input-narrow"
                  :placeholder="t('cron.timeoutPlaceholder')"
                />
              </label>
              <template v-if="simpleNotify && sessionTarget === 'isolated'">
                <label class="cron-field">
                  <span class="cron-label">{{ t('cron.deliveryChannelLabel') }}</span>
                  <select v-model="deliveryChannel" class="cron-select">
                    <option
                      v-for="opt in deliveryChannelOptions"
                      :key="opt.value"
                      :value="opt.value"
                    >
                      {{ opt.label }}
                    </option>
                  </select>
                </label>
                <label class="cron-field">
                  <span class="cron-label">
                    {{ t('cron.deliveryToLabel') }}
                    <span v-if="deliveryToRequired" class="cron-req">{{ t('cron.deliveryToRequired') }}</span>
                    <span v-else class="muted">（{{ t('common.optional') }}）</span>
                  </span>
                  <input v-model="deliveryTo" type="text" class="cron-input"
                    :placeholder="deliveryToPlaceholder" />
                </label>
                <p
                  v-if="activeSessionDeliveryPrefill && deliveryTo === activeSessionDeliveryPrefill.to && deliveryChannel === activeSessionDeliveryPrefill.channel"
                  class="muted small cron-field-hint"
                >
                  {{ t('cron.deliveryPrefillHint', { channel: deliveryChannelLabel(activeSessionDeliveryPrefill.channel) }) }}
                </p>
                <p class="muted small cron-field-hint">
                  {{ t('cron.deliveryChannelHint') }}
                </p>
                <label class="cron-check">
                  <input v-model="deliveryBestEffort" type="checkbox" />
                  {{ t('cron.deliveryBestEffort') }}
                </label>
              </template>
              <label class="cron-check">
                <input v-model="createJobEnabled" type="checkbox" />
                {{ t('cron.jobEnabledLabel') }}
              </label>
              <!-- Cron 表达式直接编辑（高级） -->
              <label v-if="quickSchedule !== 'once' && quickSchedule !== 'custom'" class="cron-field">
                <span class="cron-label">{{ t('cron.cronExprLabel') }}</span>
                <input v-model="scheduleCronExpr" type="text" class="cron-input cron-mono" :placeholder="t('cron.cronExprPlaceholder')" />
                <span class="muted small cron-field-hint">{{ t('cron.cronTzHint') }}
                  <input v-model="scheduleCronTz" type="text" class="cron-input cron-input-tz"
                    :placeholder="t('cron.cronTzPlaceholder')" /></span>
              </label>
            </fieldset>
          </div>

          <p v-if="createError" class="err small">{{ createError }}</p>
          <p v-if="createOk" class="cron-ok small">{{ createOk }}</p>
          <div class="cron-create-actions">
            <button
              type="button"
              class="lc-btn lc-btn-sm"
              :disabled="!connected || createBusy"
              @click="submitCreate"
            >
              {{ createBusy ? t('cron.loadingMore') : t('cron.createBtn') }}
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
.cron-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--lc-text-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
.cron-close:hover {
  background: var(--lc-error-bg);
  color: var(--lc-error);
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
.cron-badge {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.cron-badge--on {
  background: rgba(34, 197, 94, 0.12);
  color: #16a34a;
}
.cron-badge--off {
  background: rgba(148, 163, 184, 0.12);
  color: var(--lc-text-muted);
}
[data-theme="dark"] .cron-badge--on {
  background: rgba(34, 197, 94, 0.18);
  color: #4ade80;
}
.cron-phase {
  font-size: 12px;
}
.cron-phase--运行中 {
  color: #2563eb;
  font-weight: 600;
}
.cron-phase--已运行 {
  color: var(--lc-text-muted);
}
.cron-phase--未运行 {
  color: var(--lc-text-muted);
  opacity: 0.6;
}
.btn-danger {
  color: var(--lc-error) !important;
}
.btn-danger:hover:not(:disabled) {
  background: var(--lc-error-bg) !important;
  border-color: transparent !important;
}
.cron-run-entry__status {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--lc-text-muted);
}
.cron-run-status--ok {
  color: #16a34a;
}
[data-theme="dark"] .cron-run-status--ok {
  color: #4ade80;
}
.cron-run-status--err {
  color: var(--lc-error);
}
.cron-run-status--run {
  color: #2563eb;
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
  color: var(--lc-success, #22c55e);
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

/* ── 消费者友好新建表单 ── */
.cron-create-card {
  background: var(--lc-bg-elevated);
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  padding: 14px 16px;
  margin-bottom: 12px;
}
.cron-create-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--lc-text);
  margin-bottom: 12px;
}
.cron-create-name-input {
  font-size: 14px;
  width: 100%;
}
.cron-freq-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.cron-freq-pill {
  padding: 6px 16px;
  border-radius: 20px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text-muted);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.cron-freq-pill:hover {
  border-color: var(--lc-accent);
  color: var(--lc-text);
}
.cron-freq-pill.active {
  background: var(--lc-accent);
  border-color: var(--lc-accent);
  color: #fff;
  font-weight: 600;
}
.cron-dow-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.cron-dow-pill {
  padding: 4px 10px;
  border-radius: 16px;
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text-muted);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.cron-dow-pill:hover {
  border-color: var(--lc-accent);
  color: var(--lc-text);
}
.cron-dow-pill.active {
  background: var(--lc-accent);
  border-color: var(--lc-accent);
  color: #fff;
  font-weight: 600;
}
.cron-schedule-detail {
  padding-top: 4px;
}
.cron-input-time {
  width: auto;
  min-width: 7rem;
}
.cron-input-tz {
  display: inline-block;
  width: auto;
  min-width: 12rem;
  vertical-align: middle;
  margin-left: 4px;
  padding: 4px 8px;
  font-size: 12px;
}
.cron-create-task-textarea {
  width: 100%;
  min-height: 88px;
  box-sizing: border-box;
}
.cron-create-notify {
  margin-bottom: 12px;
  font-size: 13px;
}
.cron-advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  border: 1px dashed var(--lc-border);
  border-radius: var(--lc-radius-sm);
  background: transparent;
  color: var(--lc-text-muted);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  margin-bottom: 12px;
  text-align: left;
  transition: border-color 0.15s, color 0.15s;
}
.cron-advanced-toggle:hover {
  border-color: var(--lc-accent);
  color: var(--lc-text);
}
.cron-advanced-toggle-icon {
  font-size: 10px;
}
.cron-advanced-wrap {
  margin-bottom: 12px;
}
.cron-next-run {
  margin-top: 3px;
  font-size: 11px;
}

/* ── 状态栏升级 ── */
.cron-status-strip {
  display: flex;
  gap: 0;
  padding: 0;
  margin-bottom: 12px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-elevated);
  overflow: hidden;
}
.cron-status-item {
  flex: 1;
  padding: 10px 14px;
  border-right: 1px solid var(--lc-border);
  min-width: 0;
}
.cron-status-item:last-child {
  border-right: none;
}
.cron-status-label {
  display: block;
  font-size: 11px;
  color: var(--lc-text-muted);
  margin-bottom: 3px;
}
.cron-status-value {
  font-weight: 600;
  font-size: 13px;
  color: var(--lc-text);
  word-break: break-word;
}
.cron-status-value--sm {
  font-size: 12px;
}
.cron-status--on { color: #16a34a; }
.cron-status--off { color: var(--lc-error); }
[data-theme="dark"] .cron-status--on { color: #4ade80; }

/* ── 紧凑工具栏 ── */
.cron-toolbar-compact {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.cron-toolbar-sep {
  color: var(--lc-border);
  user-select: none;
}
.cron-select-xs {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-family: inherit;
}
.cron-select-sm {
  font-size: 12px;
  padding: 5px 8px;
  border-radius: var(--lc-radius-sm);
  border: 1px solid var(--lc-border);
  background: var(--lc-bg-raised);
  color: var(--lc-text);
  font-family: inherit;
  flex: 1 1 auto;
  min-width: 100px;
}

/* ── 空状态 ── */
.cron-empty-state {
  text-align: center;
  padding: 32px 16px;
  color: var(--lc-text-muted);
}
.cron-empty-icon {
  font-size: 32px;
  margin-bottom: 10px;
}
.cron-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--lc-text);
  margin-bottom: 6px;
}
.cron-empty-desc {
  line-height: 1.5;
}

/* ── 任务卡片 ── */
.cron-job-list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}
.cron-job-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--lc-border);
  border-top-width: 3px;
  border-radius: var(--lc-radius-sm);
  padding: 8px 10px;
  background: var(--lc-bg-raised);
  transition: box-shadow 0.15s, transform 0.1s;
}
.cron-job-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.09);
  transform: translateY(-1px);
}
/* 颜色编码（顶部边框） */
.cron-job-card--running {
  border-top-color: #22c55e;
  background: rgba(34, 197, 94, 0.03);
}
.cron-job-card--done {
  border-top-color: #f59e0b;
  background: rgba(245, 158, 11, 0.03);
}
.cron-job-card--pending {
  border-top-color: #ef4444;
  background: rgba(239, 68, 68, 0.03);
}
.cron-job-card--disabled {
  border-top-color: var(--lc-border);
  opacity: 0.55;
}
[data-theme="dark"] .cron-job-card--running  { background: rgba(34, 197, 94, 0.06); }
[data-theme="dark"] .cron-job-card--done     { background: rgba(245, 158, 11, 0.06); }
[data-theme="dark"] .cron-job-card--pending  { background: rgba(239, 68, 68, 0.06); }

.cron-job-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
}
.cron-job-card__name {
  font-weight: 600;
  font-size: 12px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cron-job-card__phase-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 20px;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.cron-job-card__phase-badge--running {
  background: rgba(34, 197, 94, 0.15);
  color: #16a34a;
}
.cron-job-card__phase-badge--done {
  background: rgba(245, 158, 11, 0.15);
  color: #b45309;
}
.cron-job-card__phase-badge--pending {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}
.cron-job-card__phase-badge--disabled {
  background: rgba(148, 163, 184, 0.12);
  color: var(--lc-text-muted);
}
[data-theme="dark"] .cron-job-card__phase-badge--running { color: #4ade80; }
[data-theme="dark"] .cron-job-card__phase-badge--done    { color: #fbbf24; }
[data-theme="dark"] .cron-job-card__phase-badge--pending { color: #f87171; }

.cron-job-card__meta {
  font-size: 11px;
  color: var(--lc-text-muted);
  margin-bottom: 6px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cron-job-card__sched {
  color: var(--lc-text);
  font-weight: 500;
  font-size: 11px;
}
.cron-job-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding-top: 4px;
  border-top: 1px solid var(--lc-border);
  margin-top: auto;
}

/* ── 执行历史区块 ── */
.cron-runs-section {
  margin-top: 8px;
  border: 1px solid var(--lc-border);
  border-radius: var(--lc-radius-sm);
  overflow: hidden;
}
.cron-runs-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--lc-bg-elevated);
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--lc-text);
  text-align: left;
  transition: background 0.15s;
}
.cron-runs-header:hover {
  background: var(--lc-bg-raised);
}
.cron-runs-header__title {
  flex: 1;
}
.cron-runs-header__arrow {
  font-size: 10px;
  color: var(--lc-text-muted);
}
.cron-runs-body {
  padding: 12px 14px;
}
.cron-runs-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
/* run entry 颜色左边框 */
.cron-run-card--ok    { border-left: 3px solid #22c55e; }
.cron-run-card--error { border-left: 3px solid #ef4444; }
.cron-run-card--running { border-left: 3px solid #2563eb; }
</style>
