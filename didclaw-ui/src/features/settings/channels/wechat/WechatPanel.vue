<script setup lang="ts">
import { getDidClawDesktopApi } from "@/lib/electron-bridge";
import { useGatewayStore } from "@/stores/gateway";
import QRCode from "qrcode";
import { computed, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { delay, useChannelContext } from "../base/useChannelContext";
import { useStreamingInstall } from "../base/useStreamingInstall";

const _emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const { showToast, ensureGatewayConnected, onSuccess: onContextSuccess } = useChannelContext();
const gwStore = useGatewayStore();

const WECHAT_PLUGIN_SPEC = "@tencent-weixin/openclaw-weixin";

// Extended state machine — covers phases before/during/after streaming
type WechatPhase =
  | "idle"
  | "running"
  | "reconnecting"
  | "success"
  | "failed"
  | "pending-restart";

const phase = ref<WechatPhase>("idle");
const qrUrl = ref<string | null>(null);
const qrDataUrl = ref<string | null>(null);

async function setQrUrl(url: string | null): Promise<void> {
  qrUrl.value = url;
  if (!url) { qrDataUrl.value = null; return; }
  try {
    qrDataUrl.value = await QRCode.toDataURL(url, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
    });
  } catch (e) {
    console.warn("[didclaw] failed to render WeChat QR image", e);
    qrDataUrl.value = null;
  }
}

function isMissingTauriCommandError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error ?? "");
  return /not allowed|command not found|unknown command/i.test(message);
}

function looksLikeAlreadyInstalled(result: {
  ok: boolean;
  error?: string;
  stdout?: string;
  stderr?: string;
}): boolean {
  return /plugin already exists|already at \d+\.\d+\.\d+/i.test(
    [result.error, result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
}

function looksLikeDangerousCodeBlocked(result: {
  ok: boolean;
  error?: string;
  stdout?: string;
  stderr?: string;
}): boolean {
  return /dangerous code patterns detected|installation blocked.*dangerous/i.test(
    [result.error, result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
}

const { lines, start, cleanup, reset: resetStreaming, pushLine } = useStreamingInstall({
  channelId: "wechat",

  processLine(line) {
    // Extract WeChat QR URL from log lines
    const m = line.match(/https:\/\/liteapp\.weixin\.qq\.com\/\S+/);
    if (m) void setQrUrl(m[0].trim());
    return { keep: true };
  },

  async onQrUrl(url) {
    if (url.includes("liteapp.weixin.qq.com") || url.includes("weixin")) {
      await setQrUrl(url);
    }
  },

  async onSuccess() {
    // Write channel config to ensure Gateway loads wechat channel
    const writeApi = getDidClawDesktopApi();
    if (writeApi?.writeChannelConfig) {
      const r = await writeApi.writeChannelConfig("openclaw-weixin", { enabled: true });
      if (!r.ok) {
        pushLine(`⚠ 写入渠道配置失败（${(r as { error?: string }).error ?? "unknown"}），AI 服务可能无法自动加载微信配置。`);
      }
    }

    phase.value = "reconnecting";
    const isGwConnected = () => (gwStore.status as string) === "connected";

    // Give Gateway 5s to process wechat plugin load/restart before polling
    await delay(5000);
    if (isGwConnected()) {
      phase.value = "success";
      onContextSuccess();
      return;
    }

    void gwStore.reloadConnection();
    const deadline = Date.now() + 35000;
    while (Date.now() < deadline) {
      await delay(800);
      if (isGwConnected()) {
        phase.value = "success";
        onContextSuccess();
        return;
      }
    }
    // Binding likely succeeded but Gateway is still initializing
    phase.value = "pending-restart";
  },

  onFail(exitCode, error) {
    phase.value = "failed";
    pushLine(`登录流程结束（exitCode=${exitCode ?? "?"}${error ? `，error=${error}` : ""}），请检查上方日志。`);
  },
});

const tickerText = computed(() =>
  lines.value.length ? lines.value.join("   •   ") : "等待微信绑定日志…",
);

async function ensurePluginInstalled(): Promise<boolean> {
  const api = getDidClawDesktopApi();
  if (!api?.checkChannelPluginInstalled) {
    pushLine("当前桌面端未提供微信插件检测能力，回退到直接安装/更新流程…");
  } else {
    try {
      const state = await api.checkChannelPluginInstalled("wechat");
      if (!state.ok) {
        showToast(`检测微信插件状态失败：${state.error}`, true);
        return false;
      }
      if (state.installed) {
        pushLine("已检测到本地微信插件，直接启动扫码登录…");
        return true;
      }
    } catch (error) {
      if (isMissingTauriCommandError(error)) {
        pushLine("当前运行中的桌面端尚未注册微信插件检测命令，回退到直接安装/更新流程…");
      } else {
        showToast(`检测微信插件状态失败：${String((error as Error)?.message ?? error)}`, true);
        return false;
      }
    }
  }

  if (!api?.openclawPluginsInstall) {
    showToast("桌面端不支持安装微信插件", true);
    return false;
  }

  pushLine(`> openclaw plugins install "${WECHAT_PLUGIN_SPEC}"`);
  pushLine("未检测到本地微信插件，正在自动安装…");

  const result = await api.openclawPluginsInstall({ packageSpec: WECHAT_PLUGIN_SPEC });
  if (result.stdout) pushLine(result.stdout);
  if (result.stderr) pushLine(result.stderr);
  if (!result.ok) {
    if (looksLikeAlreadyInstalled(result)) {
      pushLine("检测到微信插件已存在，跳过重复安装，继续启动扫码登录…");
      return true;
    }
    if (looksLikeDangerousCodeBlocked(result)) {
      pushLine("⚠ 微信插件被 OpenClaw 3.31+ 安全扫描拦截（误报）");
      pushLine("原因：官方微信插件使用 child_process 启动微信 CLI，属正常用法，安全扫描器将其误判为危险代码。");
      pushLine("请等待腾讯官方更新插件版本，或在终端执行以下命令临时跳过安全检查：");
      pushLine("  openclaw plugins install @tencent-weixin/openclaw-weixin --dangerously-force-unsafe-install");
      pushLine("执行完成后，请重新点击「开始绑定微信」按钮。");
      return false;
    }
    showToast(`自动安装微信插件失败：${result.error}`, true);
    return false;
  }

  pushLine("微信插件安装完成，正在启动扫码登录…");
  return true;
}

async function startInstall(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.startChannelQrFlow) return;

  phase.value = "running";
  resetStreaming();
  await setQrUrl(null);

  const ready = await ensurePluginInstalled();
  if (!ready) { phase.value = "failed"; return; }

  // If Gateway restarted after plugin install, wait for it to recover
  if (gwStore.status !== "connected") {
    pushLine("AI 服务正在重启，等待恢复…");
    const reconnected = await ensureGatewayConnected();
    pushLine(reconnected ? "连接已恢复。" : "连接超时，仍将尝试扫码登录…");
  }

  await start();
}

function resetPanel(): void {
  cleanup();
  resetStreaming();
  phase.value = "idle";
  qrUrl.value = null;
  qrDataUrl.value = null;
}

async function restartGateway(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.restartOpenClawGateway) {
    showToast("当前不支持重启 AI 服务", true);
    return;
  }
  const r = await api.restartOpenClawGateway();
  if (!r?.ok) {
    showToast(`重启 AI 服务失败：${(r as { error?: string }).error ?? "未知错误"}`, true);
  }
}

onUnmounted(() => {
  cleanup();
});
</script>

<template>
  <div class="ch-panel">
    <p class="ch-hint">
      {{ t('channel.wechat.hint') }}
      <a
        :href="t('channel.wechat.docLink')"
        target="_blank"
        rel="noopener"
        class="ch-link"
      >文档 ↗</a>
    </p>

    <!-- Prereq steps -->
    <div class="ch-prereq-card">
      <div class="ch-prereq-title">{{ t('channel.wechat.prereqTitle') }}</div>
      <ol class="ch-prereq-steps">
        <li>{{ t('channel.wechat.prereqStep1') }}</li>
        <li>{{ t('channel.wechat.prereqStep2') }}</li>
        <li>{{ t('channel.wechat.prereqStep3') }}</li>
      </ol>
      <p class="ch-prereq-note">⚠ {{ t('channel.wechat.prereqNote') }}</p>
    </div>

    <!-- Install wizard -->
    <div class="ch-install-card">
      <div class="ch-install-info-row">
        <span class="ch-install-info-text">点击按钮后自动安装微信官方组件并生成绑定二维码</span>
      </div>
      <div class="ch-qr-status" style="margin-top: 6px;">
        <span v-if="phase === 'idle'" class="ch-status-idle">准备就绪</span>
        <span v-else-if="phase === 'running'" class="ch-status-running">{{ t('channel.wechat.installRunning') }}</span>
        <span v-else-if="phase === 'reconnecting'" class="ch-status-running">🔄 扫码已完成，正在加载微信配置，请稍候…</span>
        <span v-else-if="phase === 'success'" class="ch-status-ok">✓ 微信已绑定，可以关闭此窗口开始对话。</span>
        <span v-else-if="phase === 'pending-restart'" class="ch-status-warn">⚠ 微信绑定已完成，但 AI 服务尚在初始化中，请点「重启 AI 服务」完成配置。</span>
        <span v-else class="ch-status-err">✗ {{ t('channel.wechat.installFail') }}</span>
      </div>

      <div v-if="qrDataUrl" class="ch-qr-wrap" style="margin-top: 8px;">
        <img :src="qrDataUrl" class="ch-qr-img" alt="WeChat QR code">
      </div>

      <div v-if="qrUrl" class="ch-wechat-qr-box">
        <p class="ch-wechat-qr-hint">用微信「扫一扫」扫描，或点链接在浏览器打开后扫码：</p>
        <a :href="qrUrl" target="_blank" rel="noopener" class="ch-link ch-wechat-qr-link">
          {{ qrUrl }}
        </a>
      </div>

      <div v-if="lines.length" class="ch-wechat-ticker">
        <div class="ch-wechat-ticker__track">
          <span class="ch-wechat-ticker__text">{{ tickerText }}</span>
          <span class="ch-wechat-ticker__text" aria-hidden="true">{{ tickerText }}</span>
        </div>
      </div>

      <div class="ch-actions" style="margin-top: 8px;">
        <button
          v-if="phase === 'idle'"
          type="button"
          class="ch-btn ch-btn--primary"
          @click="startInstall"
        >
          {{ t('channel.wechat.startInstallBtn') }}
        </button>
        <button
          v-if="phase === 'running' || phase === 'reconnecting'"
          type="button"
          class="ch-btn"
          disabled
        >
          {{ phase === 'reconnecting' ? '等待 AI 服务重载…' : t('channel.wechat.installRunning') }}
        </button>
        <template v-if="phase === 'success'">
          <button type="button" class="ch-btn ch-btn--primary" @click="$emit('close')">
            ✓ 关闭，开始对话
          </button>
          <button type="button" class="ch-btn" @click="resetPanel">重新绑定</button>
        </template>
        <template v-if="phase === 'pending-restart'">
          <button type="button" class="ch-btn ch-btn--primary" @click="restartGateway">🔄 重启 AI 服务</button>
          <button type="button" class="ch-btn" @click="resetPanel">重新绑定</button>
        </template>
        <template v-if="phase === 'failed'">
          <button type="button" class="ch-btn" @click="startInstall">重试</button>
          <button type="button" class="ch-btn" @click="restartGateway">🔄 重启 AI 服务</button>
        </template>
      </div>
    </div>
  </div>
</template>
