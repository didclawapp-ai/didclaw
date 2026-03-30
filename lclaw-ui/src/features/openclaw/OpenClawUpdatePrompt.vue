<script setup lang="ts">
import { didclawKvReadSync, didclawKvWriteSync } from "@/lib/didclaw-kv";
import { getDidClawDesktopApi, isDidClawElectron } from "@/lib/electron-bridge";
import { useGatewayStore } from "@/stores/gateway";
import { onMounted, ref } from "vue";

/** After the user clicks "Later", suppress the prompt for this npm version until a newer latest appears. */
const DISMISS_KEY = "didclaw.openclawUpdate.dismissedLatest";

const open = ref(false);
const currentVersion = ref("");
const latestVersion = ref("");
const registryError = ref<string | null>(null);
const platform = ref("");
const upgradeBusy = ref(false);
/** upgrade done — show restart prompt instead of the update notice */
const upgradeSuccess = ref(false);
const upgradeError = ref<string | null>(null);
const upgradeLogTail = ref<string | null>(null);
const restartBusy = ref(false);
const restartDone = ref(false);
const restartError = ref<string | null>(null);
const restartMessage = ref<string | null>(null);

const gw = useGatewayStore();

onMounted(() => {
  if (!isDidClawElectron()) {
    return;
  }
  window.setTimeout(() => {
    void checkOnce();
  }, 5_000);
});

async function checkOnce(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.checkOpenclawUpdate) {
    return;
  }
  try {
    const raw = await api.checkOpenclawUpdate();
    if (!raw || typeof raw !== "object" || !("ok" in raw) || raw.ok !== true) {
      return;
    }
    if (!raw.exeFound || !raw.updateAvailable || !raw.latestVersion?.trim()) {
      return;
    }
    const lv = raw.latestVersion.trim();
    try {
      if (didclawKvReadSync(DISMISS_KEY) === lv) {
        return;
      }
    } catch {
      /* private mode, etc. */
    }
    currentVersion.value = raw.currentVersion?.trim() || "(unknown)";
    latestVersion.value = lv;
    registryError.value =
      typeof raw.registryError === "string" && raw.registryError.trim()
        ? raw.registryError.trim()
        : null;
    platform.value = (raw.platform || "").trim() || "unknown";
    open.value = true;
  } catch {
    /* ignore network / IPC errors */
  }
}

function dismissForThisRelease(): void {
  const lv = latestVersion.value.trim();
  if (lv) {
    try {
      didclawKvWriteSync(DISMISS_KEY, lv);
    } catch {
      /* ignore */
    }
  }
  open.value = false;
  upgradeSuccess.value = false;
  upgradeError.value = null;
  upgradeLogTail.value = null;
  restartError.value = null;
  restartMessage.value = null;
  restartDone.value = false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function extractUpgradeLogTail(log: string | null | undefined): string | null {
  if (typeof log !== "string" || !log.trim()) {
    return null;
  }
  const lines = log
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && line !== "--- streamed ---");
  if (!lines.length) {
    return null;
  }
  return lines.slice(-6).join("\n");
}

function formatUpgradeFailure(res: {
  error?: string | null;
  exitCode: number;
  log?: string | null;
}): string {
  const err =
    typeof res.error === "string" && res.error.trim() ? res.error.trim() : `exit code ${res.exitCode}`;
  const tail = extractUpgradeLogTail(res.log);
  upgradeLogTail.value = tail;
  return tail ? `${err}. See log tail below.` : err;
}

async function onWindowsScriptUpgrade(): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.runEnsureOpenclawWindowsInstall) {
    window.alert("Built-in upgrade script is not available in this environment.");
    return;
  }
  upgradeBusy.value = true;
  upgradeError.value = null;
  upgradeLogTail.value = null;
  let gatewayStopped = false;
  try {
    if (api.stopOpenClawGateway) {
      gw.disconnect();
      restartMessage.value = "Stopping Gateway…";
      const stopRes = await api.stopOpenClawGateway();
      if (!stopRes?.ok) {
        upgradeError.value = stopRes?.error ?? "Failed to stop Gateway";
        window.setTimeout(() => {
          gw.connect();
        }, 800);
        return;
      }
      gatewayStopped = true;
    }
    restartMessage.value = "Upgrading OpenClaw…";
    // upgrade: true → -Upgrade -SkipOnboard → always runs npm install + openclaw doctor
    const res = await api.runEnsureOpenclawWindowsInstall({ skipOnboard: true, upgrade: true });
    if (res.ok) {
      dismissForThisRelease();
      upgradeSuccess.value = true;
      open.value = true;
      currentVersion.value = latestVersion.value || currentVersion.value;
      restartMessage.value = "Upgrade complete. Restarting Gateway and restoring connection…";
      await onRestartGateway(true);
    } else {
      upgradeError.value = formatUpgradeFailure(res);
      restartMessage.value = null;
      if (gatewayStopped) {
        window.setTimeout(() => {
          gw.connect();
        }, 1_200);
      }
    }
  } catch (error) {
    upgradeError.value = error instanceof Error ? error.message : "Unknown error during upgrade";
    restartMessage.value = null;
    if (gatewayStopped) {
      window.setTimeout(() => {
        gw.connect();
      }, 1_200);
    }
  } finally {
    upgradeBusy.value = false;
  }
}

async function waitForGatewayConnected(timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const isConnected = () => gw.status === "connected";
  while (Date.now() < deadline) {
    if (isConnected()) {
      await delay(800);
      return true;
    }
    await delay(500);
  }
  return false;
}

async function onRestartGateway(auto = false): Promise<void> {
  const api = getDidClawDesktopApi();
  if (!api?.restartOpenClawGateway) {
    restartError.value = "Auto-restart is not supported in this environment. Please restart Gateway manually.";
    return;
  }
  restartBusy.value = true;
  restartError.value = null;
  restartDone.value = false;
  restartMessage.value = "Restarting Gateway…";
  try {
    const result = await api.restartOpenClawGateway();
    if (!result?.ok) {
      restartError.value = (result as { error?: string }).error ?? "Failed to restart Gateway";
      restartMessage.value = null;
      return;
    }
    restartMessage.value = "Gateway restarted, restoring connection…";
    restartDone.value = true;
    await gw.reloadConnection();
    const reconnected = await waitForGatewayConnected();
    if (!reconnected) {
      restartDone.value = false;
      restartError.value = "Gateway restarted, but connection has not been restored. Please try again later.";
      restartMessage.value = null;
      return;
    }
    restartDone.value = true;
    restartMessage.value = "Gateway restarted and connection restored.";
  } finally {
    restartBusy.value = false;
  }
}

function onRestartGatewayClick(): void {
  void onRestartGateway(false);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ocu-backdrop" role="presentation" @click.self="dismissForThisRelease">
      <div
        class="ocu-panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="upgradeSuccess ? 'ocu-title-done' : 'ocu-title'"
        @click.stop
      >
        <!-- upgrade success: restart gateway panel -->
        <template v-if="upgradeSuccess">
          <div class="ocu-done-icon">✓</div>
          <h2 id="ocu-title-done" class="ocu-title">Upgrade Complete</h2>
          <p class="ocu-note small muted">
            OpenClaw has been updated to the latest version. Configuration migration
            (<code>openclaw doctor</code>) ran automatically. DidClaw will restart the
            gateway and restore the connection.
          </p>
          <p v-if="restartMessage" class="ocu-note small">{{ restartMessage }}</p>
          <p v-if="restartDone" class="ocu-restart-ok small">
            Gateway restarted and desktop client reconnected to the latest OpenClaw.
          </p>
          <p v-if="restartError" class="ocu-error small">{{ restartError }}</p>
          <div class="ocu-actions">
            <button
              v-if="!restartDone"
              type="button"
              class="lc-btn lc-btn-primary lc-btn-sm"
              :disabled="restartBusy"
              @click="onRestartGatewayClick"
            >
              {{ restartBusy ? "Restoring connection…" : "Retry Gateway Restart" }}
            </button>
            <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" @click="dismissForThisRelease">
              {{ restartDone ? "Close" : "Handle manually later" }}
            </button>
          </div>
        </template>

        <!-- new version available: upgrade prompt panel -->
        <template v-else>
          <h2 id="ocu-title" class="ocu-title">New OpenClaw Version Available</h2>
          <p class="ocu-versions">
            Current: <strong>{{ currentVersion }}</strong>
            · Latest: <strong>{{ latestVersion }}</strong>
          </p>
          <p v-if="registryError" class="ocu-warn small">
            Registry note: {{ registryError }}
          </p>
          <p class="ocu-note small muted">
            The upgrade only replaces the program files. Your config, skills and API keys
            (<code>~/.openclaw/</code>) are preserved. After upgrading,
            <code>openclaw doctor</code> runs automatically to migrate your config;
            then the gateway restarts.
          </p>
          <p v-if="upgradeError" class="ocu-error small">
            Upgrade failed: {{ upgradeError }}. You can run manually:
            <code class="ocu-code">npm install -g openclaw@latest</code>
          </p>
          <pre v-if="upgradeLogTail" class="ocu-log-tail"><code>{{ upgradeLogTail }}</code></pre>
          <p v-if="!upgradeError" class="ocu-cli small">
            Manual: <code class="ocu-code">npm install -g openclaw@latest</code>
          </p>
          <p class="ocu-doc small">
            <a
              href="https://docs.openclaw.ai/en/install/updating"
              target="_blank"
              rel="noopener noreferrer"
              class="ocu-link"
            >View official update docs</a>
          </p>
          <div class="ocu-actions">
            <button
              v-if="platform === 'windows'"
              type="button"
              class="lc-btn lc-btn-primary lc-btn-sm"
              :disabled="upgradeBusy"
              @click="onWindowsScriptUpgrade"
            >
              {{ upgradeBusy ? "Upgrading, please wait…" : "One-click Upgrade (Windows)" }}
            </button>
            <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" @click="dismissForThisRelease">
              Remind me later
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ocu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.45);
}

.ocu-panel {
  width: min(420px, 100%);
  max-height: min(90vh, 520px);
  overflow: auto;
  padding: 1.25rem 1.35rem;
  border-radius: 10px;
  background: var(--lc-surface, #1e1e1e);
  color: var(--lc-text, #e8e8e8);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.ocu-title {
  margin: 0 0 0.65rem;
  font-size: 1.05rem;
  font-weight: 600;
}

.ocu-versions {
  margin: 0 0 0.75rem;
  line-height: 1.45;
}

.ocu-warn {
  margin: 0 0 0.65rem;
  color: #f0c674;
}

.ocu-note,
.ocu-cli,
.ocu-doc {
  margin: 0 0 0.55rem;
  line-height: 1.45;
}

.ocu-code {
  display: inline-block;
  margin-top: 0.2rem;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.25);
  font-size: 0.85em;
}

.ocu-link {
  color: var(--lc-accent, #6ea8fe);
  text-decoration: none;
}
.ocu-link:hover {
  text-decoration: underline;
}

.ocu-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

.ocu-done-icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  font-size: 1.25rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.65rem;
}

.ocu-restart-ok {
  color: #22c55e;
  margin: 0 0 0.35rem;
}

.ocu-error {
  color: #f87171;
  margin: 0 0 0.55rem;
  line-height: 1.5;
}

.ocu-log-tail {
  margin: 0 0 0.65rem;
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.26);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--lc-text, #e8e8e8);
  font-size: 0.82rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
