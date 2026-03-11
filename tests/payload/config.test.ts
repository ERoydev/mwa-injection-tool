import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@solana-mobile/wallet-standard-mobile", () => ({
  createDefaultAuthorizationCache: vi.fn(() => ({
    clear: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  })),
  createDefaultChainSelector: vi.fn(() => ({ select: vi.fn() })),
  createDefaultWalletNotFoundHandler: vi.fn(() => vi.fn()),
}));

import { buildConfig } from "../../src/payload/config.js";

describe("buildConfig", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      title: "Jupiter",
      querySelector: vi.fn(() => null),
    });
    vi.stubGlobal("location", {
      origin: "https://jup.ag",
      hostname: "jup.ag",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns appIdentity with name from document.title and uri from location.origin", () => {
    const config = buildConfig();

    expect(config.appIdentity.name).toBe("Jupiter");
    expect(config.appIdentity.uri).toBe("https://jup.ag");
  });

  it("returns all three Solana chains", () => {
    const config = buildConfig();

    expect(config.chains).toEqual([
      "solana:mainnet",
      "solana:devnet",
      "solana:testnet",
    ]);
  });

  it("resolves favicon icon from link element", () => {
    vi.stubGlobal("document", {
      title: "Jupiter",
      querySelector: vi.fn(() => ({
        href: "https://jup.ag/favicon.png",
        getAttribute: () => "/favicon.png",
      })),
    });

    const config = buildConfig();

    expect(config.appIdentity.icon).toBe("https://jup.ag/favicon.png");
  });

  it("resolves relative favicon href to absolute URL", () => {
    vi.stubGlobal("document", {
      title: "Jupiter",
      querySelector: vi.fn(() => ({
        href: "https://jup.ag/assets/icon.ico",
        getAttribute: () => "/assets/icon.ico",
      })),
    });

    const config = buildConfig();

    expect(config.appIdentity.icon).toBe("https://jup.ag/assets/icon.ico");
  });

  it("matches link with rel containing icon (e.g. shortcut icon)", () => {
    vi.stubGlobal("document", {
      title: "Jupiter",
      querySelector: vi.fn((selector: string) => {
        if (selector === 'link[rel~="icon"]') {
          return {
            href: "https://jup.ag/icon.ico",
            getAttribute: () => "/icon.ico",
          };
        }
        return null;
      }),
    });

    const config = buildConfig();

    expect(config.appIdentity.icon).toBe("https://jup.ag/icon.ico");
  });

  it("returns undefined icon when no favicon link element exists", () => {
    const config = buildConfig();

    expect(config.appIdentity.icon).toBeUndefined();
  });

  it("falls back to location.hostname when document.title is empty", () => {
    vi.stubGlobal("document", {
      title: "",
      querySelector: vi.fn(() => null),
    });

    const config = buildConfig();

    expect(config.appIdentity.name).toBe("jup.ag");
  });

  it("includes authorizationCache, chainSelector, and onWalletNotFound", () => {
    const config = buildConfig();

    expect(config.authorizationCache).toBeDefined();
    expect(config.chainSelector).toBeDefined();
    expect(config.onWalletNotFound).toBeDefined();
  });
});
