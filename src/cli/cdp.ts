import type { IncomingMessage } from "node:http";
import { InjectionError, ErrorCode } from "./errors.js";
import type { ExecFn, Device } from "./device.js";

const SERIAL_PATTERN = /^[a-zA-Z0-9._:-]+$/;

function assertSafeSerial(serial: string): void {
  if (!SERIAL_PATTERN.test(serial)) {
    throw new InjectionError(ErrorCode.DEVICE_NOT_FOUND, { serial });
  }
}

const CDP_TIMEOUT = 10_000;

export interface CDPConnection {
  device: Device;
  localPort: number;
  wsEndpoint: string;
}

export interface Tab {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
  type: "page" | "background_page" | "service_worker";
}

export interface HttpModule {
  get(
    url: string,
    callback: (res: IncomingMessage) => void,
  ): { on(event: "error", listener: (err: Error) => void): void };
}

export interface WebSocketLike {
  on(event: "open" | "close", listener: () => void): void;
  on(event: "message", listener: (data: Buffer | string) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  send(data: string): void;
  close(): void;
}

export type WSConstructor = new (url: string) => WebSocketLike;

export interface EvalResult {
  value: unknown;
  exceptionDetails?: { text: string };
}

export interface InjectBeforeLoadResult {
  scriptId: string;
  verified: boolean;
}

export interface CDPClient {
  forwardCDP(device: Device): CDPConnection;
  discoverTabs(conn: CDPConnection): Promise<Tab[]>;
  injectBeforeLoad(
    tab: Tab,
    source: string,
    verifyExpression: string,
  ): Promise<InjectBeforeLoadResult>;
  registerScript(tab: Tab, source: string): Promise<string>;
  evaluateScript(tab: Tab, expression: string): Promise<EvalResult>;
  reloadPage(tab: Tab): Promise<void>;
  cleanup(conn: CDPConnection): void;
}

function httpGet(http: HttpModule, url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer | string) => {
          data += String(chunk);
        });
        res.on("end", () => resolve(data));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createCDP(deps: {
  exec: ExecFn;
  http: HttpModule;
  WebSocket: WSConstructor;
}): CDPClient {
  let nextId = 1;

  return {
    forwardCDP(device: Device): CDPConnection {
      assertSafeSerial(device.serial);
      try {
        const output = deps.exec(
          `adb -s ${device.serial} forward tcp:0 localabstract:chrome_devtools_remote`,
        );
        const port = parseInt(output.trim(), 10);
        if (isNaN(port)) {
          throw new InjectionError(ErrorCode.PORT_FORWARD_FAILED);
        }
        return {
          device,
          localPort: port,
          wsEndpoint: `ws://localhost:${String(port)}`,
        };
      } catch (e) {
        if (e instanceof InjectionError) throw e;
        throw new InjectionError(ErrorCode.PORT_FORWARD_FAILED);
      }
    },

    async discoverTabs(conn: CDPConnection): Promise<Tab[]> {
      const baseUrl = `http://localhost:${String(conn.localPort)}`;
      const retryDelays = [500, 1000, 2000];

      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        // Prefer /json (page-level tabs) — these support Page.reload/Page.loadEventFired
        try {
          const listRaw = await httpGet(deps.http, `${baseUrl}/json`);
          const list = JSON.parse(listRaw) as Tab[];
          const pageTabs = list.filter((t) => t.type === "page");
          if (pageTabs.length > 0) {
            return pageTabs;
          }
        } catch {
          // HTTP request failed, try /json/version as fallback
        }

        // Fallback: /json/version provides a browser-level endpoint
        try {
          const versionRaw = await httpGet(
            deps.http,
            `${baseUrl}/json/version`,
          );
          const version = JSON.parse(versionRaw) as Record<string, unknown>;
          if (
            typeof version["webSocketDebuggerUrl"] === "string" &&
            version["webSocketDebuggerUrl"].length > 0
          ) {
            return [
              {
                id: "browser",
                title: "Browser",
                url: "",
                webSocketDebuggerUrl: version["webSocketDebuggerUrl"] as string,
                type: "page",
              },
            ];
          }
        } catch {
          // /json/version not available either
        }

        const delay = retryDelays[attempt];
        if (delay !== undefined) {
          await sleep(delay);
        }
      }

      throw new InjectionError(ErrorCode.NO_TABS);
    },

    async injectBeforeLoad(
      tab: Tab,
      source: string,
      verifyExpression: string,
    ): Promise<InjectBeforeLoadResult> {
      return new Promise((resolve, reject) => {
        const ws = new deps.WebSocket(tab.webSocketDebuggerUrl);
        const registerId = nextId++;
        const enableId = nextId++;
        const reloadId = nextId++;
        const verifyId = nextId++;
        const timer = setTimeout(() => {
          ws.close();
          reject(
            new InjectionError(ErrorCode.TIMEOUT, {
              ms: String(CDP_TIMEOUT),
            }),
          );
        }, CDP_TIMEOUT);

        let scriptId = "";

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              id: registerId,
              method: "Page.addScriptToEvaluateOnNewDocument",
              params: { source },
            }),
          );
        });

        ws.on("message", (data) => {
          const msg = JSON.parse(String(data)) as Record<string, unknown>;

          if (msg["id"] === registerId) {
            const result = msg["result"] as
              | Record<string, unknown>
              | undefined;
            scriptId = String(result?.["identifier"] ?? "");
            ws.send(
              JSON.stringify({ id: enableId, method: "Page.enable" }),
            );
          }

          if (msg["id"] === enableId) {
            ws.send(
              JSON.stringify({ id: reloadId, method: "Page.reload" }),
            );
          }

          if (msg["method"] === "Page.loadEventFired") {
            setTimeout(() => {
              ws.send(
                JSON.stringify({
                  id: verifyId,
                  method: "Runtime.evaluate",
                  params: { expression: verifyExpression, returnByValue: true },
                }),
              );
            }, 500);
          }

          if (msg["id"] === verifyId) {
            clearTimeout(timer);
            ws.close();
            const result = msg["result"] as
              | Record<string, unknown>
              | undefined;
            const inner = result?.["result"] as
              | Record<string, unknown>
              | undefined;
            resolve({
              scriptId,
              verified: inner?.["value"] === true,
            });
          }
        });

        ws.on("error", () => {
          clearTimeout(timer);
          ws.close();
          reject(new InjectionError(ErrorCode.TAB_CONNECT_FAILED));
        });
      });
    },

    async registerScript(tab: Tab, source: string): Promise<string> {
      return new Promise((resolve, reject) => {
        const ws = new deps.WebSocket(tab.webSocketDebuggerUrl);
        const id = nextId++;
        const timer = setTimeout(() => {
          ws.close();
          reject(
            new InjectionError(ErrorCode.TIMEOUT, {
              ms: String(CDP_TIMEOUT),
            }),
          );
        }, CDP_TIMEOUT);

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              id,
              method: "Page.addScriptToEvaluateOnNewDocument",
              params: { source },
            }),
          );
        });

        ws.on("message", (data) => {
          const msg = JSON.parse(String(data)) as Record<string, unknown>;
          if (msg["id"] === id) {
            clearTimeout(timer);
            const result = msg["result"] as Record<string, unknown> | undefined;
            const identifier = result?.["identifier"] ?? "";
            ws.close();
            resolve(String(identifier));
          }
        });

        ws.on("error", () => {
          clearTimeout(timer);
          ws.close();
          reject(new InjectionError(ErrorCode.TAB_CONNECT_FAILED));
        });
      });
    },

    async evaluateScript(tab: Tab, expression: string): Promise<EvalResult> {
      return new Promise((resolve, reject) => {
        const ws = new deps.WebSocket(tab.webSocketDebuggerUrl);
        const id = nextId++;
        const timer = setTimeout(() => {
          ws.close();
          reject(
            new InjectionError(ErrorCode.TIMEOUT, {
              ms: String(CDP_TIMEOUT),
            }),
          );
        }, CDP_TIMEOUT);

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              id,
              method: "Runtime.evaluate",
              params: { expression, returnByValue: true },
            }),
          );
        });

        ws.on("message", (data) => {
          const msg = JSON.parse(String(data)) as Record<string, unknown>;
          if (msg["id"] === id) {
            clearTimeout(timer);
            ws.close();
            const result = msg["result"] as Record<string, unknown> | undefined;
            const exceptionDetails = msg["exceptionDetails"] as
              | Record<string, unknown>
              | undefined;
            if (exceptionDetails) {
              resolve({
                value: undefined,
                exceptionDetails: {
                  text: String(exceptionDetails["text"] ?? "Unknown error"),
                },
              });
            } else {
              const inner = result?.["result"] as
                | Record<string, unknown>
                | undefined;
              resolve({ value: inner?.["value"] });
            }
          }
        });

        ws.on("error", () => {
          clearTimeout(timer);
          ws.close();
          reject(new InjectionError(ErrorCode.TAB_CONNECT_FAILED));
        });
      });
    },

    async reloadPage(tab: Tab): Promise<void> {
      return new Promise((resolve, reject) => {
        const ws = new deps.WebSocket(tab.webSocketDebuggerUrl);
        const enableId = nextId++;
        const reloadId = nextId++;
        const timer = setTimeout(() => {
          ws.close();
          reject(
            new InjectionError(ErrorCode.TIMEOUT, {
              ms: String(CDP_TIMEOUT),
            }),
          );
        }, CDP_TIMEOUT);

        ws.on("open", () => {
          ws.send(JSON.stringify({ id: enableId, method: "Page.enable" }));
        });

        ws.on("message", (data) => {
          const msg = JSON.parse(String(data)) as Record<string, unknown>;
          if (msg["id"] === enableId) {
            ws.send(JSON.stringify({ id: reloadId, method: "Page.reload" }));
          }
          if (msg["method"] === "Page.loadEventFired") {
            clearTimeout(timer);
            ws.close();
            resolve();
          }
        });

        ws.on("error", () => {
          clearTimeout(timer);
          ws.close();
          reject(new InjectionError(ErrorCode.TAB_CONNECT_FAILED));
        });
      });
    },

    cleanup(conn: CDPConnection): void {
      try {
        assertSafeSerial(conn.device.serial);
        deps.exec(
          `adb -s ${conn.device.serial} forward --remove tcp:${String(conn.localPort)}`,
        );
      } catch {
        // Swallow errors — cleanup is best-effort
      }
    },
  };
}
