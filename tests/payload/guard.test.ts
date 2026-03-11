import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { guard } from "../../src/payload/guard.js";
import { INJECTED_FLAG } from "../../src/payload/constants.js";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

describe("guard", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { userAgent: ANDROID_UA });
    vi.stubGlobal("isSecureContext", true);
    (window as unknown as Record<string, unknown>)[INJECTED_FLAG] = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns already_injected when flag is set", () => {
    (window as unknown as Record<string, unknown>)[INJECTED_FLAG] = true;

    const result = guard();

    expect(result).toEqual({ canInject: false, reason: "already_injected" });
  });

  it("returns not_android when UA is not Android", () => {
    vi.stubGlobal("navigator", { userAgent: DESKTOP_UA });

    const result = guard();

    expect(result).toEqual({ canInject: false, reason: "not_android" });
  });

  it("returns not_secure_context when not HTTPS", () => {
    vi.stubGlobal("isSecureContext", false);

    const result = guard();

    expect(result).toEqual({
      canInject: false,
      reason: "not_secure_context",
    });
  });

  it("returns canInject true when all checks pass", () => {
    const result = guard();

    expect(result).toEqual({ canInject: true });
  });

  it("has no reason property when canInject is true", () => {
    const result = guard();

    expect(result.canInject).toBe(true);
    expect("reason" in result).toBe(false);
  });

  it("checks idempotency flag before Android UA", () => {
    (window as unknown as Record<string, unknown>)[INJECTED_FLAG] = true;
    vi.stubGlobal("navigator", { userAgent: DESKTOP_UA });

    const result = guard();

    expect(result.canInject).toBe(false);
    if (!result.canInject) {
      expect(result.reason).toBe("already_injected");
    }
  });

  it("checks Android UA before secure context", () => {
    vi.stubGlobal("navigator", { userAgent: DESKTOP_UA });
    vi.stubGlobal("isSecureContext", false);

    const result = guard();

    expect(result.canInject).toBe(false);
    if (!result.canInject) {
      expect(result.reason).toBe("not_android");
    }
  });
});
