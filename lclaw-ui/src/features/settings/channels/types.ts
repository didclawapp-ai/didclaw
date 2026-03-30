import type { Ref } from "vue";

export type SetupParadigm = "qr" | "wizard" | "credential" | "oauth";
export type ChannelSource = "builtin" | "plugin";

export interface ChannelConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "multiselect" | "oauth-button";
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface ChannelDef {
  id: string;
  source: ChannelSource;
  icon: string;
  /** i18n key */
  nameKey: string;
  paradigm: SetupParadigm;
  privacyLevel?: "normal" | "sensitive";
  supportsMultiAccount?: boolean;
  /** i18n key */
  docLinkKey?: string;

  // Built-in channel installation metadata
  pluginPackageSpec?: string;
  configPatch?: Record<string, unknown>;
  restartGatewayAfterSetup?: boolean;

  // Plugin channel fields (populated from Manifest)
  packageName?: string;
  version?: string;
  configSchema?: ChannelConfigField[];
}

export interface EnsureChannelReadyOptions {
  installPlugin?: boolean;
  writeConfigPatch?: boolean;
  restartGateway?: boolean;
  restartToast?: string;
  installFailureMessage?: string;
  configFailureMessage?: string;
  successToast?: string;
}

/** Shared context provided by ChannelSetupDialog, injected by panel components. */
export interface ChannelContext {
  busy: Ref<boolean>;
  toast: Ref<string | null>;
  toastError: Ref<boolean>;
  showToast: (msg: string, error?: boolean) => void;
  ensureGatewayConnected: (timeoutMs?: number) => Promise<boolean>;
  restartGatewayAndReconnect: (toastMessage?: string) => Promise<boolean>;
  ensureChannelReady: (
    channelKey: string,
    options?: EnsureChannelReadyOptions,
  ) => Promise<boolean>;
  /** Called by a panel on successful setup to trigger auto-close countdown. */
  onSuccess: () => void;
}
