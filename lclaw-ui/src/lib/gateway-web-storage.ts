const STORAGE_KEY = "lclaw.ui.gateway";

export type WebGatewayStored = {
  url?: string;
  token?: string;
  password?: string;
};

export function readWebGatewayStored(): WebGatewayStored {
  if (typeof localStorage === "undefined") {
    return {};
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw?.trim()) {
      return {};
    }
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") {
      return {};
    }
    const r = o as Record<string, unknown>;
    const out: WebGatewayStored = {};
    if (typeof r.url === "string") {
      out.url = r.url;
    }
    if (typeof r.token === "string") {
      out.token = r.token;
    }
    if (typeof r.password === "string") {
      out.password = r.password;
    }
    return out;
  } catch {
    return {};
  }
}

/** 写入浏览器覆盖项；仅包含有值的字段（空 token/password 不写回，以便继续用 .env） */
export function writeWebGatewayOverrides(input: {
  url: string;
  token: string;
  password: string;
}): void {
  const url = input.url.trim();
  if (!url) {
    return;
  }
  const payload: WebGatewayStored = { url };
  const t = input.token.trim();
  const p = input.password.trim();
  if (t) {
    payload.token = t;
  }
  if (p) {
    payload.password = p;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearWebGatewayOverrides(): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
}
