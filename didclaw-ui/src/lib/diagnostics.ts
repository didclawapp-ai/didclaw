export type DiagnosticsSnapshot = {
  app: {
    version: string;
    mode: string;
    baseUrl: string;
  };
  gateway: {
    wsUrl: string;
    status: string;
    helloInfo: string | null;
    lastError: string | null;
    tokenConfigured: boolean;
    passwordConfigured: boolean;
  };
  session: {
    listError: string | null;
    activeSessionKey: string | null;
    sessionCount: number;
  };
  chat: {
    lastError: string | null;
    messageCount: number;
  };
  client: {
    userAgent: string;
    language: string;
  };
  linkAllowlist: {
    configured: boolean;
  };
};

/**
 * 汇总联调诊断信息（**不含** token / 密码明文，仅布尔标记是否配置）。
 */
export function buildDiagnosticsSnapshot(input: {
  version: string;
  gatewayWsUrl: string;
  connectionStatus: string;
  helloInfo: string | null;
  gatewayLastError: string | null;
  sessionListError: string | null;
  activeSessionKey: string | null;
  sessionCount: number;
  chatLastError: string | null;
  messageCount: number;
  /** 含桌面端本地库（didclaw.db）等非 env 来源时传入 */
  gatewayTokenConfigured?: boolean;
  gatewayPasswordConfigured?: boolean;
}): DiagnosticsSnapshot {
  const tokenConfigured =
    input.gatewayTokenConfigured ?? !!import.meta.env.VITE_GATEWAY_TOKEN?.trim();
  const passwordConfigured =
    input.gatewayPasswordConfigured ?? !!import.meta.env.VITE_GATEWAY_PASSWORD?.trim();
  return {
    app: {
      version: input.version,
      mode: import.meta.env.MODE,
      baseUrl: import.meta.env.BASE_URL,
    },
    gateway: {
      wsUrl: input.gatewayWsUrl,
      status: input.connectionStatus,
      helloInfo: input.helloInfo,
      lastError: input.gatewayLastError,
      tokenConfigured,
      passwordConfigured,
    },
    session: {
      listError: input.sessionListError,
      activeSessionKey: input.activeSessionKey,
      sessionCount: input.sessionCount,
    },
    chat: {
      lastError: input.chatLastError,
      messageCount: input.messageCount,
    },
    client: {
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      language: typeof navigator !== "undefined" ? navigator.language : "",
    },
    linkAllowlist: {
      configured: !!import.meta.env.VITE_LINK_ALLOWLIST?.trim(),
    },
  };
}

export function diagnosticsToPrettyJson(snapshot: DiagnosticsSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
