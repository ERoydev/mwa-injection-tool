import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import http from "node:http";
import WebSocket from "ws";
import { createDeviceManager } from "./device.js";
import { createCDP } from "./cdp.js";
import type { CDPConnection } from "./cdp.js";
import { createLogger } from "./logger.js";
import { InjectionError, ErrorCode, ERROR_META } from "./errors.js";

const GUARD_REASON_MESSAGES: Record<string, string> = {
  already_injected: "Wallet already injected — skipping",
  not_android: "Not an Android device — injection requires Android Chrome",
  not_secure_context: "Page is not a secure context (HTTPS required)",
};

interface CLIArgs {
  device?: string;
  verbose: boolean;
  noReload: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = { verbose: false, noReload: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--verbose" || arg === "-v") {
      args.verbose = true;
    } else if (arg === "--no-reload") {
      args.noReload = true;
    } else if (arg === "--device" || arg === "-d") {
      args.device = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: mwa-inject [options]",
          "",
          "Options:",
          "  -d, --device <serial>  Target device serial (default: auto-detect)",
          "  -v, --verbose          Enable debug logging to stderr",
          "      --no-reload        Use Runtime.evaluate instead of inject-before-load",
          "  -h, --help             Show this help message",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  return args;
}

function readPayload(): string {
  const payloadPath = resolve(
    import.meta.dirname ?? ".",
    "mwa-inject.min.js",
  );
  try {
    return readFileSync(payloadPath, "utf-8");
  } catch {
    throw new InjectionError(ErrorCode.PAYLOAD_NOT_FOUND, {
      path: payloadPath,
    });
  }
}

export async function main(
  argv: string[] = process.argv,
  deps?: {
    exec?: (cmd: string) => string;
    httpModule?: typeof http;
    WSConstructor?: new (url: string) => InstanceType<typeof WebSocket>;
    readPayloadFn?: () => string;
  },
): Promise<void> {
  const args = parseArgs(argv);
  const logger = createLogger({ verbose: args.verbose });

  const exec =
    deps?.exec ??
    ((cmd: string) => execSync(cmd, { encoding: "utf-8", timeout: 15_000 }));

  const dm = createDeviceManager({ exec });
  const cdp = createCDP({
    exec,
    http: (deps?.httpModule ?? http) as Parameters<typeof createCDP>[0]["http"],
    WebSocket: (deps?.WSConstructor ?? WebSocket) as Parameters<
      typeof createCDP
    >[0]["WebSocket"],
  });

  let conn: CDPConnection | undefined;

  const cleanup = () => {
    if (conn) {
      logger.debug("Cleaning up port forward");
      cdp.cleanup(conn);
      conn = undefined;
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(1);
  });

  try {
    // Step 1: Detect devices
    logger.debug("Detecting devices...");
    const devices = dm.detectDevices();
    const device = dm.selectDevice(devices, args.device);
    logger.info(`Device: ${device.serial} (${device.type}: ${device.model})`);

    // Step 2: Forward CDP
    logger.debug("Forwarding CDP port...");
    conn = cdp.forwardCDP(device);
    logger.debug(`CDP port: ${String(conn.localPort)}`);

    // Step 3: Discover tabs
    logger.debug("Discovering tabs...");
    const tabs = await cdp.discoverTabs(conn);
    const tab = tabs[0];
    if (!tab) {
      throw new InjectionError(ErrorCode.NO_TABS);
    }
    logger.info(`Tab: ${tab.title} (${tab.url})`);
    if (tabs.length > 1) {
      logger.debug(
        `Selected first of ${String(tabs.length)} tabs (heuristic: first page tab)`,
      );
    }

    // Step 4: Read payload
    const payload = deps?.readPayloadFn ? deps.readPayloadFn() : readPayload();
    logger.debug(`Payload size: ${String(payload.length)} bytes`);

    if (args.noReload) {
      // Fallback: Runtime.evaluate (late injection)
      logger.debug("Mode: --no-reload (Runtime.evaluate)");
      const evalResult = await cdp.evaluateScript(tab, payload);

      if (evalResult.exceptionDetails) {
        throw new InjectionError(ErrorCode.PAYLOAD_EXCEPTION, {
          exception: evalResult.exceptionDetails.text,
        });
      }

      // The esbuild IIFE sets window.__mwaInject.result — read it separately
      const resultEval = await cdp.evaluateScript(
        tab,
        "window.__mwaInject && window.__mwaInject.result",
      );
      const result = resultEval.value as
        | { success: boolean; reason: string }
        | undefined;
      if (result && !result.success) {
        const msg =
          GUARD_REASON_MESSAGES[result.reason] ?? `Skipped: ${result.reason}`;
        logger.error(ErrorCode.VERIFY_FAILED, msg);
        process.exitCode = 1;
        return;
      }

      // Verify injection for --no-reload mode
      logger.debug("Verifying injection...");
      const verifyResult = await cdp.evaluateScript(
        tab,
        "window.__MWA_INJECTED__",
      );

      if (verifyResult.value === true) {
        logger.success("Wallet registration confirmed");
      } else {
        logger.error(
          ErrorCode.VERIFY_FAILED,
          "Wallet registration could not be verified",
        );
        process.exitCode = 1;
      }
    } else {
      // Primary: inject-before-load (A-1)
      // Uses a single WebSocket connection for register → reload → verify
      // (addScriptToEvaluateOnNewDocument is scoped to the CDP session)
      logger.debug(
        "Mode: inject-before-load (Page.addScriptToEvaluateOnNewDocument)",
      );
      const result = await cdp.injectBeforeLoad(
        tab,
        payload,
        "window.__MWA_INJECTED__",
      );
      logger.debug(`Script registered: ${result.scriptId}`);

      if (result.verified) {
        logger.success("Wallet registration confirmed");
      } else {
        logger.error(
          ErrorCode.VERIFY_FAILED,
          "Wallet registration could not be verified",
        );
        process.exitCode = 1;
      }
    }
  } catch (e) {
    if (e instanceof InjectionError) {
      logger.error(e.code, e.message);
      const meta = ERROR_META[e.code];
      if (args.verbose && e.stack) {
        logger.debug(e.stack);
      }
      logger.debug(`Retryable: ${String(meta.retryable)}`);
    } else {
      logger.error(ErrorCode.TIMEOUT, (e as Error).message);
      if (args.verbose && (e as Error).stack) {
        logger.debug((e as Error).stack as string);
      }
    }
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("cli.js");

if (isDirectRun) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
