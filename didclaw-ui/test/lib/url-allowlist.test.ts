import { afterEach, describe, expect, it, vi } from "vitest";
import { isLinkHrefAllowed } from "@/lib/url-allowlist";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isLinkHrefAllowed — always-allowed cases (no allowlist config)", () => {
  it("allows anchor links (#section)", () => {
    expect(isLinkHrefAllowed("#section")).toBe(true);
  });

  it("allows relative paths", () => {
    expect(isLinkHrefAllowed("./images/photo.png")).toBe(true);
    expect(isLinkHrefAllowed("../docs/readme.md")).toBe(true);
  });

  it("allows mailto: links", () => {
    expect(isLinkHrefAllowed("mailto:user@example.com")).toBe(true);
  });

  it("allows tel: links", () => {
    expect(isLinkHrefAllowed("tel:+1234567890")).toBe(true);
  });

  it("allows http://localhost", () => {
    expect(isLinkHrefAllowed("http://localhost:3000/api")).toBe(true);
  });

  it("allows http://127.0.0.1", () => {
    expect(isLinkHrefAllowed("http://127.0.0.1:8080/")).toBe(true);
  });

  it("allows http://[::1]", () => {
    expect(isLinkHrefAllowed("http://[::1]:8080/")).toBe(true);
  });
});

describe("isLinkHrefAllowed — always-blocked cases", () => {
  it("blocks empty string", () => {
    expect(isLinkHrefAllowed("")).toBe(false);
  });

  it("blocks javascript: scheme", () => {
    expect(isLinkHrefAllowed("javascript:alert(1)")).toBe(false);
  });

  it("blocks data: scheme", () => {
    expect(isLinkHrefAllowed("data:text/html,<h1>xss</h1>")).toBe(false);
  });

  it("blocks vbscript: scheme", () => {
    expect(isLinkHrefAllowed("vbscript:msgbox(1)")).toBe(false);
  });

  it("blocks protocol-relative URL", () => {
    expect(isLinkHrefAllowed("//example.com")).toBe(false);
  });

  it("blocks ftp: scheme (not http/https)", () => {
    expect(isLinkHrefAllowed("ftp://example.com/file.zip")).toBe(false);
  });

  it("blocks external http without any allowlist config", () => {
    expect(isLinkHrefAllowed("https://github.com")).toBe(false);
  });
});

describe("isLinkHrefAllowed — wildcard allowlist (*)", () => {
  it("allows any https when VITE_LINK_ALLOWLIST is *", () => {
    vi.stubEnv("VITE_LINK_ALLOWLIST", "*");
    expect(isLinkHrefAllowed("https://github.com/user/repo")).toBe(true);
    expect(isLinkHrefAllowed("https://example.com")).toBe(true);
  });

  it("still blocks blocked schemes even with wildcard", () => {
    vi.stubEnv("VITE_LINK_ALLOWLIST", "*");
    expect(isLinkHrefAllowed("javascript:void(0)")).toBe(false);
  });
});

describe("isLinkHrefAllowed — domain rule", () => {
  it("allows exact domain match", () => {
    vi.stubEnv("VITE_LINK_ALLOWLIST", "github.com");
    expect(isLinkHrefAllowed("https://github.com/user/repo")).toBe(true);
  });

  it("does not allow subdomain when rule is exact domain", () => {
    vi.stubEnv("VITE_LINK_ALLOWLIST", "github.com");
    expect(isLinkHrefAllowed("https://api.github.com/v1")).toBe(false);
  });

  it("supports comma-separated domain list", () => {
    vi.stubEnv("VITE_LINK_ALLOWLIST", "github.com, example.com");
    expect(isLinkHrefAllowed("https://github.com/repo")).toBe(true);
    expect(isLinkHrefAllowed("https://example.com/page")).toBe(true);
    expect(isLinkHrefAllowed("https://other.com")).toBe(false);
  });
});

describe("isLinkHrefAllowed — wildcard subdomain rule (*.domain.com)", () => {
  it("allows subdomain matching *.example.com", () => {
    vi.stubEnv("VITE_LINK_ALLOWLIST", "*.example.com");
    expect(isLinkHrefAllowed("https://cdn.example.com/img.png")).toBe(true);
    expect(isLinkHrefAllowed("https://api.example.com/v2")).toBe(true);
  });

  it("also allows the root domain itself with *.example.com", () => {
    vi.stubEnv("VITE_LINK_ALLOWLIST", "*.example.com");
    expect(isLinkHrefAllowed("https://example.com/page")).toBe(true);
  });

  it("does not allow unrelated domain", () => {
    vi.stubEnv("VITE_LINK_ALLOWLIST", "*.example.com");
    expect(isLinkHrefAllowed("https://attacker.com")).toBe(false);
  });
});

describe("isLinkHrefAllowed — prefix URL rule", () => {
  it("allows URL that starts with the prefix", () => {
    vi.stubEnv("VITE_LINK_ALLOWLIST", "https://docs.example.com/guide");
    expect(isLinkHrefAllowed("https://docs.example.com/guide/setup")).toBe(true);
  });

  it("allows same origin even without path prefix match", () => {
    vi.stubEnv("VITE_LINK_ALLOWLIST", "https://docs.example.com");
    expect(isLinkHrefAllowed("https://docs.example.com/other")).toBe(true);
  });

  it("does not allow different origin", () => {
    vi.stubEnv("VITE_LINK_ALLOWLIST", "https://docs.example.com/guide");
    expect(isLinkHrefAllowed("https://evil.com/guide")).toBe(false);
  });
});
