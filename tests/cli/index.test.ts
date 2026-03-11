// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { main } from "../../src/cli/index.js";

const DEVICE_OUTPUT = "List of devices attached\nemulator-5554\tdevice\n\n";
const MODEL_OUTPUT = "sdk_gphone64_arm64";
const PORT_OUTPUT = "12345\n";
const VERSION_JSON = JSON.stringify({
  Browser: "Chrome/120",
  webSocketDebuggerUrl: "ws://localhost:12345/devtools/browser/abc",
});

function createMockDeps(overrides?: {
  execResponses?: Record<string, string>;
  evalValue?: unknown;
  evalException?: string;
  noReload?: boolean;
  payload?: string;
}) {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const mockWs = {
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event]?.push(listener);
    },
    send: vi.fn((data: string) => {
      const msg = JSON.parse(data) as Record<string, unknown>;
      const method = msg["method"] as string;
      const id = msg["id"] as number;

      queueMicrotask(() => {
        if (method === "Page.addScriptToEvaluateOnNewDocument") {
          triggerWs(
            "message",
            JSON.stringify({ id, result: { identifier: "script-1" } }),
          );
        } else if (method === "Page.enable") {
          triggerWs("message", JSON.stringify({ id, result: {} }));
        } else if (method === "Page.reload") {
          queueMicrotask(() => {
            triggerWs(
              "message",
              JSON.stringify({ method: "Page.loadEventFired", params: {} }),
            );
          });
        } else if (method === "Runtime.evaluate") {
          const expression = (msg["params"] as Record<string, unknown>)?.[
            "expression"
          ] as string;
          if (expression === "window.__MWA_INJECTED__") {
            triggerWs(
              "message",
              JSON.stringify({
                id,
                result: { result: { value: true } },
              }),
            );
          } else if (overrides?.evalException) {
            triggerWs(
              "message",
              JSON.stringify({
                id,
                exceptionDetails: { text: overrides.evalException },
                result: {},
              }),
            );
          } else {
            triggerWs(
              "message",
              JSON.stringify({
                id,
                result: {
                  result: {
                    value: overrides?.evalValue ?? {
                      success: true,
                      reason: "registered",
                    },
                  },
                },
              }),
            );
          }
        }
      });
    }),
    close: vi.fn(),
  };

  function triggerWs(event: string, data?: unknown) {
    const list = handlers[event];
    if (list) {
      for (const fn of list) fn(data);
    }
  }

  const execResponses: Record<string, string> = {
    "adb devices": DEVICE_OUTPUT,
    "ro.product.model": MODEL_OUTPUT,
    forward: PORT_OUTPUT,
    "forward --remove": "",
    ...overrides?.execResponses,
  };

  const exec = vi.fn((command: string) => {
    for (const [pattern, response] of Object.entries(execResponses)) {
      if (command.includes(pattern)) return response;
    }
    return "";
  });

  const httpGet = vi.fn(
    (
      url: string,
      callback: (res: {
        on: (e: string, l: (...a: unknown[]) => void) => void;
      }) => void,
    ) => {
      const res = {
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          if (event === "data") queueMicrotask(() => listener(VERSION_JSON));
          if (event === "end")
            queueMicrotask(() => queueMicrotask(() => listener()));
        }),
      };
      callback(res);
      return { on: vi.fn() };
    },
  );

  const httpModule = { get: httpGet };

  const WSConstructor = vi.fn(function () {
    queueMicrotask(() => triggerWs("open"));
    return mockWs;
  });

  return {
    exec,
    httpModule: httpModule as never,
    WSConstructor: WSConstructor as never,
    readPayloadFn: () =>
      overrides?.payload ?? "(function(){window.__MWA_INJECTED__=true})();",
    mockWs,
  };
}

describe("main", () => {
  beforeEach(() => {
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("runs the full inject-before-load pipeline successfully", async () => {
    const deps = createMockDeps();

    await main(["node", "cli.js"], deps);

    expect(process.exitCode).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Wallet registration confirmed"),
    );
  });

  it("uses Runtime.evaluate with --no-reload flag", async () => {
    const deps = createMockDeps();

    await main(["node", "cli.js", "--no-reload"], deps);

    expect(process.exitCode).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Wallet registration confirmed"),
    );
  });

  it("reports guard reason on --no-reload when payload returns failure", async () => {
    const deps = createMockDeps({
      evalValue: { success: false, reason: "not_android" },
    });

    await main(["node", "cli.js", "--no-reload"], deps);

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Not an Android device"),
    );
  });

  it("throws PAYLOAD_EXCEPTION on --no-reload when eval has exception", async () => {
    const deps = createMockDeps({
      evalException: "SyntaxError: unexpected token",
    });

    await main(["node", "cli.js", "--no-reload"], deps);

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Payload threw"),
    );
  });

  it("exits with code 1 when no devices found", async () => {
    const deps = createMockDeps({
      execResponses: {
        "adb devices": "List of devices attached\n\n",
      },
    });

    await main(["node", "cli.js"], deps);

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("No Android devices found"),
    );
  });

  it("exits with code 1 when payload file not found", async () => {
    const { InjectionError, ErrorCode } =
      await import("../../src/cli/errors.js");

    const deps = createMockDeps();
    deps.readPayloadFn = () => {
      throw new InjectionError(ErrorCode.PAYLOAD_NOT_FOUND, {
        path: "/missing",
      });
    };

    await main(["node", "cli.js"], deps);

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Payload file not found"),
    );
  });

  it("passes --device flag to selectDevice", async () => {
    const deps = createMockDeps();

    await main(["node", "cli.js", "--device", "emulator-5554"], deps);

    expect(deps.exec).toHaveBeenCalledWith(
      expect.stringContaining("emulator-5554"),
    );
  });

  it("enables verbose logging with --verbose flag", async () => {
    const deps = createMockDeps();

    await main(["node", "cli.js", "--verbose"], deps);

    expect(process.stderr.write).toHaveBeenCalled();
  });

  it("logs tab selection info when multiple tabs exist", async () => {
    const multiTabJson = JSON.stringify({});
    const tabListJson = JSON.stringify([
      {
        id: "A",
        title: "Jupiter",
        url: "https://jup.ag",
        webSocketDebuggerUrl: "ws://localhost:12345/devtools/page/A",
        type: "page",
      },
      {
        id: "B",
        title: "Raydium",
        url: "https://raydium.io",
        webSocketDebuggerUrl: "ws://localhost:12345/devtools/page/B",
        type: "page",
      },
    ]);

    const deps = createMockDeps();
    deps.httpModule = {
      get: vi.fn(
        (
          url: string,
          callback: (res: {
            on: (e: string, l: (...a: unknown[]) => void) => void;
          }) => void,
        ) => {
          const body = url.includes("/json/version")
            ? multiTabJson
            : tabListJson;
          const res = {
            on: vi.fn(
              (event: string, listener: (...args: unknown[]) => void) => {
                if (event === "data") queueMicrotask(() => listener(body));
                if (event === "end")
                  queueMicrotask(() => queueMicrotask(() => listener()));
              },
            ),
          };
          callback(res);
          return { on: vi.fn() };
        },
      ),
    } as never;

    await main(["node", "cli.js", "--verbose"], deps);

    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("first of 2 tabs"),
    );
  });
});
