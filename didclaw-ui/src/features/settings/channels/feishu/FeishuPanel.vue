<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import QRCode from "qrcode";
import { computed, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useChannelContext } from "../base/useChannelContext";
import { useStreamingInstall } from "../base/useStreamingInstall";

const { t } = useI18n();
const { busy, showToast, restartGatewayAndReconnect } = useChannelContext();

// ── QR helpers ────────────────────────────────────────────────────────────────

function isQrLine(line: string): boolean {
  return line.length >= 16 && /^[█▀▄ ]+$/u.test(line);
}

function extractQrBlock(ls: string[]): string[] {
  let best: string[] = [];
  let current: string[] = [];
  for (const line of ls) {
    if (isQrLine(line)) { current.push(line); continue; }
    if (current.length > best.length) best = current;
    current = [];
  }
  if (current.length > best.length) best = current;
  return best.length >= 10 ? best : [];
}

function buildSvgQrDataUrl(block: string[]): string | null {
  if (!block.length) return null;
  const width = Math.max(...block.map((l) => l.length));
  const rows: boolean[][] = [];
  for (const rawLine of block) {
    const line = rawLine.padEnd(width, " ");
    const top: boolean[] = [];
    const bottom: boolean[] = [];
    for (const ch of line) {
      switch (ch) {
        case "█": top.push(true);  bottom.push(true);  break;
        case "▀": top.push(true);  bottom.push(false); break;
        case "▄": top.push(false); bottom.push(true);  break;
        default:  top.push(false); bottom.push(false); break;
      }
    }
    rows.push(top, bottom);
  }
  if (!rows.length || !rows[0]?.length) return null;
  const h = rows.length;
  const w = rows[0].length;
  const m = 4; const s = 6;
  const rects = rows.flatMap((row, y) =>
    row.flatMap((on, x) =>
      on ? [`<rect x="${(x+m)*s}" y="${(y+m)*s}" width="${s}" height="${s}" fill="#000"/>`] : [],
    ),
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(w+m*2)*s}" height="${(h+m*2)*s}" viewBox="0 0 ${(w+m*2)*s} ${(h+m*2)*s}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/>${rects.join("")}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ── State ─────────────────────────────────────────────────────────────────────

const qrDataUrl = ref<string | null>(null);
const installSummary = ref<string | null>(null);
const suppressedCount = ref(0);
const needsResidueCleanup = ref(false);
const cleanupBusy = ref(false);
const manualOpen = ref(false);
const domain = ref<"feishu" | "lark">("feishu");
const appId = ref("");
const appSecret = ref("");

// ── useStreamingInstall ───────────────────────────────────────────────────────

const { state, lines, start, cleanup, reset: resetStreaming } = useStreamingInstall({
  channelId: "feishu",

  processLine(line) {
    // Suppress noisy lines unrelated to Feishu install
    const suppress =
      /^npm warn Unknown env config /i.test(line) ||
      /plugins\.entries\.whatsapp: plugin whatsapp: duplicate plugin id detected/i.test(line) ||
      /extensions[\\/](whatsapp)[\\/]/i.test(line);
    if (suppress) {
      suppressedCount.value += 1;
      return { keep: false };
    }
    // Detect residue that needs cleanup
    if (/plugin already exists|plugin not found:\s*openclaw-lark|delete it first/i.test(line)) {
      needsResidueCleanup.value = true;
    }
    return { keep: true };
  },

  async onQrUrl(url) {
    try {
      qrDataUrl.value = await QRCode.toDataURL(url, {
        width: 220,
        margin: 1,
        errorCorrectionLevel: "M",
      });
    } catch {
      qrDataUrl.value = null;
    }
  },

  async onSuccess() {
    const api = getDidClawDesktopApi();
    if (api?.writeChannelConfig) {
      try {
        const r = await api.writeChannelConfig("feishu", { enabled: true });
        if (!r.ok) {
          lines.value = [
            ...lines.value,
            `⚠ 已完成飞书安装向导，但启用 channels.feishu.enabled 失败：${(r as { error?: string }).error ?? "unknown"}`,
          ];
        }
      } catch (e) {
        lines.value = [
          ...lines.value,
          `⚠ 已完成飞书安装向导，但写入飞书渠道配置失败：${String((e as Error)?.message ?? e)}`,
        ];
      }
    }
    manualOpen.value = false;
    needsResidueCleanup.value = false;
    installSummary.value =
      "飞书安装向导已完成！点「重启 AI 服务」按钮使配置生效，然后在飞书中向 AI 发一条消息验证是否正常响应。";
  },

  onFail(exitCode) {
    installSummary.value = needsResidueCleanup.value
      ? '检测到旧的飞书插件残留，请先点下方"清理飞书残留"再重新运行安装向导。'
      : `安装向导退出失败（退出码 ${exitCode ?? "?"}）`;
  },
});

// ── Derived ───────────────────────────────────────────────────────────────────

const tickerText = computed(() =>
  lines.value.length ? lines.value.join("   •   ") : "等待飞书安装日志…",
);

// Refresh ASCII QR whenever lines change
function refreshAsciiQr(): void {
  const block = extractQrBlock(lines.value);
  if (block.length) {
    qrDataUrl.value = buildSvgQrDataUrl(block) ?? qrDataUrl.value;
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function checkEnvReady(): Promise<boolean> {
  const api = getDidClawDesktopApi();
  if (!api?.getOpenClawSetupStatus) return true;
  try {
    const s = await api.getOpenClawSetupStatus();
    if (!s.openclawDirExists || !s.openclawCli?.ok) {
      installSummary.value = "请先完成应用初始化设置，重启应用后将自动引导完成配置。";
      return false;
    }
  } catch { /* ignore */ }
  return true;
}

async function startInstall(): Promise<void> {
  if (!await checkEnvReady()) return;
  qrDataUrl.value = null;
  installSummary.value = "正在运行飞书官方安装向导，请按终端提示完成创建/关联机器人。";
  suppressedCount.value = 0;
  needsResidueCleanup.value = false;

  // Watch lines for ASCII QR after start
  const stopWatch = (() => {
    let prev = 0;
    const id = setInterval(() => {
      if (lines.value.length !== prev) {
        prev = lines.value.length;
        refreshAsciiQr();
      }
    }, 300);
    return () => clearInterval(id);
  })();

  await start();
  stopWatch();
}

async function cleanupResidue(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.cleanupChannelResidue) {
    installSummary.value = "自动清理失败，请重新运行安装向导，或重启应用后再试。";
    return;
  }
  cleanupBusy.value = true;
  try {
    const r = await api.cleanupChannelResidue("feishu");
    if (!r.ok) { installSummary.value = `清理飞书残留失败：${r.error}`; return; }
    const removed = r.removed.length + r.removedDirs.length;
    needsResidueCleanup.value = false;
    resetStreaming();
    qrDataUrl.value = null;
    suppressedCount.value = 0;
    installSummary.value = removed > 0
      ? "已清理飞书残留配置，可以重新运行安装向导。"
      : "未发现飞书残留目录；若仍失败，可直接重新运行安装向导。";
  } catch (e) {
    installSummary.value = `清理飞书残留失败：${String((e as Error)?.message ?? e)}`;
  } finally {
    cleanupBusy.value = false;
  }
}

async function restartGateway(): Promise<void> {
  await restartGatewayAndReconnect();
}

async function saveManualCredentials(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api) return;
  const id = appId.value.trim();
  const sec = appSecret.value.trim();
  if (!id || !sec) { showToast("请填写 App ID 和 App Secret", true); return; }
  if (!api.configureFeishuPlugin) {
    showToast("当前桌面端不支持写入飞书官方插件配置，请先重启应用更新桌面端。", true);
    return;
  }
  busy.value = true;
  try {
    const r = await api.configureFeishuPlugin({ appId: id, appSecret: sec, domain: domain.value });
    if (r.ok) { showToast("已写入飞书官方插件配置"); }
    else { showToast(`保存失败：${r.error}`, true); }
  } catch (e) {
    showToast(t("channel.saveFail") + `：${e}`, true);
  } finally {
    busy.value = false;
  }
}

onUnmounted(() => {
  cleanup();
});
</script>

<template>
  <div class="ch-panel">
    <p class="ch-hint">
      {{ t('channel.feishu.hint') }}
      <a
        :href="t('channel.feishu.docLink')"
        target="_blank"
        rel="noopener"
        class="ch-link"
      >官方文档 ↗</a>
    </p>

    <!-- Install wizard -->
    <div class="ch-install-card">
      <div class="ch-install-info-row">
        <span class="ch-install-info-text">向导将自动创建飞书机器人并完成配置</span>
      </div>
      <div class="ch-qr-status" style="margin-top: 6px;">
        <span v-if="state === 'idle'" class="ch-status-idle">准备就绪</span>
        <span v-else-if="state === 'running'" class="ch-status-running">{{ t('channel.feishu.installRunning') }}</span>
        <span v-else-if="state === 'success'" class="ch-status-ok">✓ {{ t('channel.feishu.installSuccess') }}</span>
        <span v-else class="ch-status-err">✗ {{ t('channel.feishu.installFail') }}</span>
      </div>
      <p v-if="installSummary" class="ch-restart-hint" style="margin-top: 8px;">
        {{ installSummary }}
      </p>
      <p
        v-if="suppressedCount > 0"
        class="muted small"
        style="margin-top: 6px;"
      >
        已省略 {{ suppressedCount }} 条与飞书安装无关的重复插件警告，避免干扰查看。
      </p>
      <div v-if="qrDataUrl" class="ch-qr-wrap" style="margin-top: 8px;">
        <img :src="qrDataUrl" class="ch-qr-img" alt="Feishu QR code">
      </div>
      <div v-if="lines.length" class="ch-wechat-ticker" style="margin-top: 8px;">
        <div class="ch-wechat-ticker__track">
          <span class="ch-wechat-ticker__text">{{ tickerText }}</span>
          <span class="ch-wechat-ticker__text" aria-hidden="true">{{ tickerText }}</span>
        </div>
      </div>
      <div class="ch-actions" style="margin-top: 8px;">
        <button
          v-if="state === 'idle' || state === 'failed'"
          type="button"
          class="ch-btn ch-btn--primary"
          @click="startInstall"
        >
          {{ t('channel.feishu.startInstallBtn') }}
        </button>
        <button v-if="state === 'running'" type="button" class="ch-btn" disabled>
          {{ t('channel.feishu.installRunning') }}
        </button>
        <button
          v-if="state === 'success'"
          type="button"
          class="ch-btn ch-btn--primary"
          @click="restartGateway"
        >
          🔄 重启 AI 服务
        </button>
        <button
          v-if="state === 'success'"
          type="button"
          class="ch-btn"
          @click="startInstall"
        >
          重新运行向导
        </button>
        <button
          v-if="needsResidueCleanup"
          type="button"
          class="ch-btn"
          :disabled="cleanupBusy"
          @click="cleanupResidue"
        >
          {{ cleanupBusy ? '清理中…' : '清理飞书残留' }}
        </button>
      </div>
    </div>

    <!-- Manual credentials (collapsible fallback) -->
    <button type="button" class="ch-toggle-manual" @click="manualOpen = !manualOpen">
      {{ manualOpen ? '▾' : '▸' }} {{ t('channel.feishu.orManual') }}
    </button>
    <template v-if="manualOpen">
      <div class="ch-form">
        <label class="ch-label">{{ t('channel.feishu.domain') }}</label>
        <select v-model="domain" class="ch-select">
          <option value="feishu">{{ t('channel.feishu.domainFeishu') }}</option>
          <option value="lark">{{ t('channel.feishu.domainLark') }}</option>
        </select>
        <label class="ch-label">{{ t('channel.feishu.appId') }}</label>
        <input
          v-model="appId"
          type="text"
          class="ch-input"
          :placeholder="t('channel.feishu.appIdPlh')"
        >
        <label class="ch-label">{{ t('channel.feishu.appSecret') }}</label>
        <input
          v-model="appSecret"
          type="password"
          class="ch-input"
          :placeholder="t('channel.feishu.appSecretPlh')"
        >
      </div>
      <p class="ch-restart-hint">{{ t('channel.restartHint') }}</p>
      <div class="ch-actions">
        <button
          type="button"
          class="ch-btn ch-btn--primary"
          :disabled="busy"
          @click="saveManualCredentials"
        >
          {{ busy ? t('common.saving') : t('channel.saveBtn') }}
        </button>
      </div>
    </template>
  </div>
</template>
