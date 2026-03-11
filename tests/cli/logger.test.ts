// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../../src/cli/logger.js";
import { ErrorCode, ERROR_META } from "../../src/cli/errors.js";

describe("createLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an object with info, success, error, debug methods", () => {
    const logger = createLogger({ verbose: false });
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.success).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  describe("non-verbose mode", () => {
    it("info writes to stdout", () => {
      const logger = createLogger({ verbose: false });
      logger.info("hello");
      expect(console.log).toHaveBeenCalledWith("hello");
    });

    it("success writes to stdout with checkmark prefix", () => {
      const logger = createLogger({ verbose: false });
      logger.success("done");
      expect(console.log).toHaveBeenCalledWith("✓ done");
    });

    it("error writes to stderr with code and remediation", () => {
      const logger = createLogger({ verbose: false });
      logger.error(ErrorCode.NO_DEVICE, "test message");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(ErrorCode.NO_DEVICE),
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(ERROR_META[ErrorCode.NO_DEVICE].remediation),
      );
    });

    it("error output includes the caller-supplied message", () => {
      const logger = createLogger({ verbose: false });
      logger.error(ErrorCode.NO_DEVICE, "custom caller message");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("custom caller message"),
      );
    });

    it("debug is a no-op", () => {
      const logger = createLogger({ verbose: false });
      logger.debug("should not appear");
      expect(process.stderr.write).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe("verbose mode", () => {
    function getStderrOutput(): string {
      const calls = vi.mocked(process.stderr.write).mock.calls;
      const firstCall = calls[0];
      if (!firstCall) throw new Error("stderr.write was not called");
      return String(firstCall[0]);
    }

    it("debug writes to stderr with ISO timestamp prefix", () => {
      const logger = createLogger({ verbose: true });
      logger.debug("verbose message");
      expect(process.stderr.write).toHaveBeenCalledOnce();
      const output = getStderrOutput();
      expect(output).toMatch(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\]/,
      );
    });

    it("debug output includes the message content", () => {
      const logger = createLogger({ verbose: true });
      logger.debug("my debug info");
      const output = getStderrOutput();
      expect(output).toContain("my debug info");
    });

    it("debug output ends with newline", () => {
      const logger = createLogger({ verbose: true });
      logger.debug("test");
      const output = getStderrOutput();
      expect(output.endsWith("\n")).toBe(true);
    });
  });
});
