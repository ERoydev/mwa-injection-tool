import { ErrorCode, ERROR_META } from "./errors.js";

export interface Logger {
  info(msg: string): void;
  success(msg: string): void;
  error(code: ErrorCode, msg: string): void;
  debug(msg: string): void;
}

export function createLogger(opts: { verbose: boolean }): Logger {
  return {
    info(msg: string): void {
      console.log(msg);
    },

    success(msg: string): void {
      console.log(`✓ ${msg}`);
    },

    error(code: ErrorCode, msg: string): void {
      const meta = ERROR_META[code];
      console.error(
        `Error [${code}]: ${msg}\n  Remediation: ${meta.remediation}`,
      );
    },

    debug(msg: string): void {
      if (opts.verbose) {
        process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`);
      }
    },
  };
}
