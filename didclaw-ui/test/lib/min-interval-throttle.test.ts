import { describe, expect, it, vi } from "vitest";
import { createMinIntervalThrottle } from "@/lib/min-interval-throttle";

describe("createMinIntervalThrottle", () => {
  it("allows first fire immediately", () => {
    const t = createMinIntervalThrottle(100);
    expect(t()).toEqual({ ok: true });
  });

  it("blocks second fire within interval using mocked time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    const t = createMinIntervalThrottle(1000);
    expect(t()).toEqual({ ok: true });
    const second = t();
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.msSinceLast).toBe(0);
    }
    vi.setSystemTime(new Date("2020-01-01T00:00:01.000Z"));
    expect(t()).toEqual({ ok: true });
    vi.useRealTimers();
  });
});
