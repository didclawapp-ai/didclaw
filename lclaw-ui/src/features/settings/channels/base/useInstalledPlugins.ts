import { defineAsyncComponent, ref } from "vue";
import { useGatewayStore } from "@/stores/gateway";
import type { InstalledPluginManifest } from "../types";
import type { ChannelEntry } from "../registry";

const GenericPluginPanel = defineAsyncComponent(
  () => import("../_generic/GenericPluginPanel.vue"),
);

/**
 * Fetches plugin channels dynamically from Gateway's plugins.installed RPC.
 * Gracefully returns empty list if the RPC is not available (older Gateway).
 */
export function useInstalledPlugins() {
  const channels = ref<ChannelEntry[]>([]);
  const loading = ref(false);
  const gwStore = useGatewayStore();

  async function fetchInstalledPlugins(): Promise<void> {
    const gc = gwStore.client;
    if (!gc || gwStore.status !== "connected") return;

    loading.value = true;
    try {
      const res = await gc.request<{ plugins?: InstalledPluginManifest[] } | null>(
        "plugins.installed",
        { timeoutMs: 5000 },
      );
      const plugins = res?.plugins ?? [];
      channels.value = plugins.map((m): ChannelEntry => ({
        id: m.channelId,
        source: "plugin",
        icon: m.icon,
        nameKey: `channel.${m.channelId}.name`,
        displayName: m.displayName,
        paradigm: m.paradigm,
        privacyLevel: m.privacyLevel,
        supportsMultiAccount: m.supportsMultiAccount,
        packageName: m.packageName,
        version: m.version,
        configSchema: m.configSchema,
        panel: GenericPluginPanel,
      }));
    } catch {
      // Gateway does not yet support plugins.installed — degrade silently
      channels.value = [];
    } finally {
      loading.value = false;
    }
  }

  return { channels, loading, fetchInstalledPlugins };
}
