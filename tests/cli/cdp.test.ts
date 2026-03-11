// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCDP } from "../../src/cli/cdp.js";
import type {
  HttpModule,
  WSConstructor,
  WebSocketLike,
} from "../../src/cli/cdp.js";
import { ErrorCode, InjectionError } from "../../src/cli/errors.js";
import type { ExecFn, Device } from "../../src/cli/device.js";
import { EventEmitter } from "node:events";

function getFirstSentMessage(
  sendMock: ReturnType<typeof vi.fn>,
): Record<string, unknown> {
  const call = sendMock.mock.calls[0];
  if (!call) throw new Error("send was never called");
  return JSON.parse(call[0] as string) as Record<string, unknown>;
}

const DEVICE: Device = {
  serial: "emulator-5554",
  type: "emulator",
  model: "sdk_gphone64_arm64",
};

function createMockWS(): WebSocketLike & {
  _trigger: (event: string, data?: unknown) => void;
} {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const mock = {
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event]?.push(listener);
    },
    send: vi.fn(),
    close: vi.fn(),
    _trigger(event: string, data?: unknown) {
      const list = handlers[event];
      if (list) {
        for (const fn of list) fn(data);
      }
    },
  };
  return mock as unknown as WebSocketLike & {
    _trigger: (event: string, data?: unknown) => void;
  };
}

function createMockHttp(responses: Record<string, string>): HttpModule {
  const mock = {
    get(url: string, callback: (res: EventEmitter) => void) {
      const res = new EventEmitter();
      const body = responses[url];
      queueMicrotask(() => {
        if (body !== undefined) {
          res.emit("data", body);
          res.emit("end");
        } else {
          res.emit("error", new Error("Not found"));
        }
      });
      callback(res);
      const req = new EventEmitter();
      return req;
    },
  };
  return mock as unknown as HttpModule;
}

describe("forwardCDP", () => {
  it("returns CDPConnection with parsed ephemeral port", () => {
    const exec = vi.fn().mockReturnValue("12345\n") as unknown as ExecFn;
    const cdp = createCDP({
      exec,
      http: createMockHttp({}),
      WebSocket: vi.fn() as unknown as WSConstructor,
    });

    const conn = cdp.forwardCDP(DEVICE);

    expect(conn.localPort).toBe(12345);
    expect(conn.device).toBe(DEVICE);
    expect(conn.wsEndpoint).toBe("ws://localhost:12345");
    expect(exec).toHaveBeenCalledWith(
      "adb -s emulator-5554 forward tcp:0 localabstract:chrome_devtools_remote",
    );
  });

  it("throws PORT_FORWARD_FAILED when exec throws", () => {
    const exec = vi.fn().mockImplementation(() => {
      throw new Error("adb failed");
    }) as unknown as ExecFn;
    const cdp = createCDP({
      exec,
      http: createMockHttp({}),
      WebSocket: vi.fn() as unknown as WSConstructor,
    });

    expect(() => cdp.forwardCDP(DEVICE)).toThrow(InjectionError);
    try {
      cdp.forwardCDP(DEVICE);
    } catch (e) {
      expect((e as InjectionError).code).toBe(ErrorCode.PORT_FORWARD_FAILED);
    }
  });

  it("throws PORT_FORWARD_FAILED when output is non-numeric", () => {
    const exec = vi.fn().mockReturnValue("error text\n") as unknown as ExecFn;
    const cdp = createCDP({
      exec,
      http: createMockHttp({}),
      WebSocket: vi.fn() as unknown as WSConstructor,
    });

    expect(() => cdp.forwardCDP(DEVICE)).toThrow(InjectionError);
  });
});

describe("discoverTabs", () => {
  const conn = {
    device: DEVICE,
    localPort: 12345,
    wsEndpoint: "ws://localhost:12345",
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns tab from /json/version when webSocketDebuggerUrl is present", async () => {
    const http = createMockHttp({
      "http://localhost:12345/json/version": JSON.stringify({
        Browser: "Chrome/120",
        webSocketDebuggerUrl: "ws://localhost:12345/devtools/browser/abc",
      }),
    });
    const cdp = createCDP({
      exec: vi.fn() as unknown as ExecFn,
      http,
      WebSocket: vi.fn() as unknown as WSConstructor,
    });

    const tabs = await cdp.discoverTabs(conn);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.webSocketDebuggerUrl).toBe(
      "ws://localhost:12345/devtools/browser/abc",
    );
  });

  it("falls back to /json when /json/version lacks webSocketDebuggerUrl", async () => {
    const http = createMockHttp({
      "http://localhost:12345/json/version": JSON.stringify({
        Browser: "Chrome/120",
      }),
      "http://localhost:12345/json": JSON.stringify([
        {
          id: "ABC123",
          title: "Jupiter",
          url: "https://jup.ag",
          webSocketDebuggerUrl: "ws://localhost:12345/devtools/page/ABC123",
          type: "page",
        },
      ]),
    });
    const cdp = createCDP({
      exec: vi.fn() as unknown as ExecFn,
      http,
      WebSocket: vi.fn() as unknown as WSConstructor,
    });

    const tabs = await cdp.discoverTabs(conn);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.title).toBe("Jupiter");
  });

  it("filters to only page type tabs from /json", async () => {
    const http = createMockHttp({
      "http://localhost:12345/json/version": JSON.stringify({}),
      "http://localhost:12345/json": JSON.stringify([
        {
          id: "A",
          title: "Page",
          url: "https://a.com",
          webSocketDebuggerUrl: "ws://localhost:12345/devtools/page/A",
          type: "page",
        },
        {
          id: "B",
          title: "SW",
          url: "chrome-extension://x",
          webSocketDebuggerUrl: "ws://localhost:12345/devtools/page/B",
          type: "service_worker",
        },
      ]),
    });
    const cdp = createCDP({
      exec: vi.fn() as unknown as ExecFn,
      http,
      WebSocket: vi.fn() as unknown as WSConstructor,
    });

    const tabs = await cdp.discoverTabs(conn);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.id).toBe("A");
  });

  it("throws NO_TABS after retries when no page tabs found", async () => {
    vi.useRealTimers();
    const http = createMockHttp({
      "http://localhost:12345/json/version": JSON.stringify({}),
      "http://localhost:12345/json": JSON.stringify([]),
    });
    const cdp = createCDP({
      exec: vi.fn() as unknown as ExecFn,
      http,
      WebSocket: vi.fn() as unknown as WSConstructor,
    });

    await expect(cdp.discoverTabs(conn)).rejects.toThrow(InjectionError);

    const code = await cdp
      .discoverTabs(conn)
      .catch((e: InjectionError) => e.code);
    expect(code).toBe(ErrorCode.NO_TABS);

    vi.useFakeTimers();
  }, 15_000);
});

describe("registerScript", () => {
  const tab: Parameters<ReturnType<typeof createCDP>["registerScript"]>[0] = {
    id: "ABC",
    title: "Test",
    url: "https://test.com",
    webSocketDebuggerUrl: "ws://localhost:12345/devtools/page/ABC",
    type: "page",
  };

  it("sends Page.addScriptToEvaluateOnNewDocument and returns identifier", async () => {
    const mockWs = createMockWS();
    const WSConstructor = vi.fn(function () {
      return mockWs;
    }) as unknown as WSConstructor;
    const cdp = createCDP({
      exec: vi.fn() as unknown as ExecFn,
      http: createMockHttp({}),
      WebSocket: WSConstructor,
    });

    const promise = cdp.registerScript(tab, "console.log('hello')");

    // Simulate WebSocket open
    mockWs._trigger("open");

    // Verify the sent message
    expect(mockWs.send).toHaveBeenCalledOnce();
    const sent = getFirstSentMessage(mockWs.send as ReturnType<typeof vi.fn>);
    expect(sent["method"]).toBe("Page.addScriptToEvaluateOnNewDocument");
    expect(sent["params"]).toEqual({ source: "console.log('hello')" });

    // Simulate CDP response
    mockWs._trigger(
      "message",
      JSON.stringify({ id: sent["id"], result: { identifier: "script-42" } }),
    );

    const result = await promise;
    expect(result).toBe("script-42");
  });

  it("rejects with TAB_CONNECT_FAILED on WebSocket error", async () => {
    const mockWs = createMockWS();
    const WSConstructor = vi.fn(function () {
      return mockWs;
    }) as unknown as WSConstructor;
    const cdp = createCDP({
      exec: vi.fn() as unknown as ExecFn,
      http: createMockHttp({}),
      WebSocket: WSConstructor,
    });

    const promise = cdp.registerScript(tab, "console.log('hello')");
    mockWs._trigger("error", new Error("connection refused"));

    await expect(promise).rejects.toThrow(InjectionError);
    const code = await promise.catch((e: unknown) => (e as InjectionError).code);
    expect(code).toBe(ErrorCode.TAB_CONNECT_FAILED);
  });

  it("rejects with TIMEOUT when no CDP response received", async () => {
    vi.useFakeTimers();
    const mockWs = createMockWS();
    const WSConstructor = vi.fn(function () {
      return mockWs;
    }) as unknown as WSConstructor;
    const cdp = createCDP({
      exec: vi.fn() as unknown as ExecFn,
      http: createMockHttp({}),
      WebSocket: WSConstructor,
    });

    const promise = cdp.registerScript(tab, "console.log('hello')");
    mockWs._trigger("open");

    const rejection = expect(promise).rejects.toThrow(InjectionError);
    await vi.advanceTimersByTimeAsync(10_001);
    await rejection;
    vi.useRealTimers();
  });
});

describe("reloadPage", () => {
  const tab = {
    id: "ABC",
    title: "Test",
    url: "https://test.com",
    webSocketDebuggerUrl: "ws://localhost:12345/devtools/page/ABC",
    type: "page" as const,
  };

  it("sends Page.enable then Page.reload and resolves on Page.loadEventFired", async () => {
    const mockWs = createMockWS();
    const WSConstructor = vi.fn(function () {
      return mockWs;
    }) as unknown as WSConstructor;
    const cdp = createCDP({
      exec: vi.fn() as unknown as ExecFn,
      http: createMockHttp({}),
      WebSocket: WSConstructor,
    });

    const promise = cdp.reloadPage(tab);

    mockWs._trigger("open");

    // First message should be Page.enable
    const enableMsg = getFirstSentMessage(
      mockWs.send as ReturnType<typeof vi.fn>,
    );
    expect(enableMsg["method"]).toBe("Page.enable");

    // Simulate Page.enable response to trigger Page.reload
    mockWs._trigger(
      "message",
      JSON.stringify({ id: enableMsg["id"], result: {} }),
    );

    // Second message should be Page.reload
    const sendMock = mockWs.send as ReturnType<typeof vi.fn>;
    const reloadCall = sendMock.mock.calls[1];
    if (!reloadCall) throw new Error("Page.reload not sent");
    const reloadMsg = JSON.parse(reloadCall[0] as string) as Record<
      string,
      unknown
    >;
    expect(reloadMsg["method"]).toBe("Page.reload");

    // Simulate Page.loadEventFired event
    mockWs._trigger(
      "message",
      JSON.stringify({
        method: "Page.loadEventFired",
        params: { timestamp: 1234567890.123 },
      }),
    );

    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects with TIMEOUT when Page.loadEventFired not received", async () => {
    vi.useFakeTimers();
    const mockWs = createMockWS();
    const WSConstructor = vi.fn(function () {
      return mockWs;
    }) as unknown as WSConstructor;
    const cdp = createCDP({
      exec: vi.fn() as unknown as ExecFn,
      http: createMockHttp({}),
      WebSocket: WSConstructor,
    });

    const promise = cdp.reloadPage(tab);
    mockWs._trigger("open");

    // Attach rejection handler before advancing timers to prevent unhandled rejection
    const rejection = expect(promise).rejects.toThrow(InjectionError);
    await vi.advanceTimersByTimeAsync(10_001);
    await rejection;
    vi.useRealTimers();
  });
});

describe("cleanup", () => {
  it("calls exec with correct adb forward --remove command", () => {
    const exec = vi.fn() as unknown as ExecFn;
    const cdp = createCDP({
      exec,
      http: createMockHttp({}),
      WebSocket: vi.fn() as unknown as WSConstructor,
    });

    const conn = {
      device: DEVICE,
      localPort: 12345,
      wsEndpoint: "ws://localhost:12345",
    };

    cdp.cleanup(conn);
    expect(exec).toHaveBeenCalledWith(
      "adb -s emulator-5554 forward --remove tcp:12345",
    );
  });

  it("does not throw when exec fails", () => {
    const exec = vi.fn().mockImplementation(() => {
      throw new Error("cleanup failed");
    }) as unknown as ExecFn;
    const cdp = createCDP({
      exec,
      http: createMockHttp({}),
      WebSocket: vi.fn() as unknown as WSConstructor,
    });

    const conn = {
      device: DEVICE,
      localPort: 12345,
      wsEndpoint: "ws://localhost:12345",
    };

    expect(() => cdp.cleanup(conn)).not.toThrow();
  });
});
