import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { GuardResult } from "../../src/payload/guard.js";

const mockGuard = vi.fn<() => GuardResult>();
const mockBuildConfig = vi.fn();
const mockRegisterMwa = vi.fn();

vi.mock("../../src/payload/guard.js", () => ({
  guard: () => mockGuard(),
}));

vi.mock("../../src/payload/config.js", () => ({
  buildConfig: () => mockBuildConfig(),
}));

vi.mock("@solana-mobile/wallet-standard-mobile", () => ({
  registerMwa: (config: unknown) => mockRegisterMwa(config),
}));

describe("payload/index", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
    });
    vi.stubGlobal("isSecureContext", true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockGuard.mockReset();
    mockBuildConfig.mockReset();
    mockRegisterMwa.mockReset();

    mockBuildConfig.mockReturnValue({
      appIdentity: { name: "Test", uri: "https://test.com" },
      chains: ["solana:mainnet", "solana:devnet", "solana:testnet"],
      authorizationCache: {},
      chainSelector: {},
      onWalletNotFound: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    (window as unknown as Record<string, unknown>)["__MWA_INJECTED__"] =
      undefined;
  });

  async function runPayload() {
    vi.resetModules();
    const mod = await import("../../src/payload/index.js");
    return mod.result;
  }

  it("calls registerMwa and returns success on valid environment", async () => {
    mockGuard.mockReturnValue({ canInject: true });

    const result = await runPayload();

    expect(mockRegisterMwa).toHaveBeenCalledOnce();
    expect(
      (window as unknown as Record<string, unknown>)["__MWA_INJECTED__"],
    ).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      "[MWA Inject] Wallet registered successfully",
    );
    expect(result).toEqual({ success: true, reason: "registered" });
  });

  it("passes buildConfig result to registerMwa", async () => {
    mockGuard.mockReturnValue({ canInject: true });
    const fakeConfig = {
      appIdentity: { name: "Jupiter", uri: "https://jup.ag" },
      chains: ["solana:mainnet"],
      authorizationCache: {},
      chainSelector: {},
      onWalletNotFound: vi.fn(),
    };
    mockBuildConfig.mockReturnValue(fakeConfig);

    await runPayload();

    expect(mockRegisterMwa).toHaveBeenCalledWith(fakeConfig);
  });

  it("skips injection and returns failure when guard returns not_android", async () => {
    mockGuard.mockReturnValue({ canInject: false, reason: "not_android" });

    const result = await runPayload();

    expect(mockRegisterMwa).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[MWA Inject] Skipped: not_android",
    );
    expect(result).toEqual({ success: false, reason: "not_android" });
  });

  it("skips injection when guard returns already_injected", async () => {
    mockGuard.mockReturnValue({
      canInject: false,
      reason: "already_injected",
    });

    await runPayload();

    expect(mockRegisterMwa).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[MWA Inject] Skipped: already_injected",
    );
  });

  it("skips injection when guard returns not_secure_context", async () => {
    mockGuard.mockReturnValue({
      canInject: false,
      reason: "not_secure_context",
    });

    await runPayload();

    expect(mockRegisterMwa).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[MWA Inject] Skipped: not_secure_context",
    );
  });

  it("handles registerMwa throwing an error", async () => {
    mockGuard.mockReturnValue({ canInject: true });
    mockRegisterMwa.mockImplementation(() => {
      throw new Error("Registration failed");
    });

    const result = await runPayload();

    expect(console.error).toHaveBeenCalledWith(
      "[MWA Inject] Error: Registration failed",
    );
    expect(
      (window as unknown as Record<string, unknown>)["__MWA_INJECTED__"],
    ).toBeUndefined();
    expect(result).toEqual({ success: false, reason: "error" });
  });
});
