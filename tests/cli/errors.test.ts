// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ErrorCode, ERROR_META, InjectionError } from "../../src/cli/errors.js";

const ALL_CODES = Object.values(ErrorCode);

describe("ErrorCode", () => {
  it("has exactly 10 members", () => {
    expect(ALL_CODES).toHaveLength(10);
  });

  it("contains all expected values", () => {
    const expected = [
      "NO_DEVICE",
      "DEVICE_NOT_FOUND",
      "PORT_FORWARD_FAILED",
      "NO_TABS",
      "TAB_CONNECT_FAILED",
      "PAYLOAD_EXCEPTION",
      "PAYLOAD_NOT_FOUND",
      "VERIFY_FAILED",
      "BUNDLE_TOO_LARGE",
      "TIMEOUT",
    ];
    expect(ALL_CODES).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(ALL_CODES));
  });
});

describe("ERROR_META", () => {
  it.each(ALL_CODES)(
    "returns { message, remediation, retryable } for %s",
    (code) => {
      const meta = ERROR_META[code];
      expect(meta).toBeDefined();
      expect(typeof meta.message).toBe("string");
      expect(meta.message.length).toBeGreaterThan(0);
      expect(typeof meta.remediation).toBe("string");
      expect(meta.remediation.length).toBeGreaterThan(0);
      expect(typeof meta.retryable).toBe("boolean");
    },
  );

  it("has unique messages for every code", () => {
    const messages = ALL_CODES.map((code) => ERROR_META[code].message);
    const unique = new Set(messages);
    expect(unique.size).toBe(messages.length);
  });
});

describe("InjectionError", () => {
  it("sets code property from ErrorCode", () => {
    const error = new InjectionError(ErrorCode.NO_DEVICE);
    expect(error.code).toBe(ErrorCode.NO_DEVICE);
  });

  it("sets message from ERROR_META", () => {
    const error = new InjectionError(ErrorCode.NO_DEVICE);
    expect(error.message).toBe(ERROR_META[ErrorCode.NO_DEVICE].message);
  });

  it("is an instance of Error", () => {
    const error = new InjectionError(ErrorCode.NO_DEVICE);
    expect(error).toBeInstanceOf(Error);
  });

  it("is an instance of InjectionError", () => {
    const error = new InjectionError(ErrorCode.NO_DEVICE);
    expect(error).toBeInstanceOf(InjectionError);
  });

  it("has name set to InjectionError", () => {
    const error = new InjectionError(ErrorCode.NO_DEVICE);
    expect(error.name).toBe("InjectionError");
  });

  it("substitutes template placeholders with context", () => {
    const error = new InjectionError(ErrorCode.DEVICE_NOT_FOUND, {
      serial: "abc123",
    });
    expect(error.message).toContain("abc123");
    expect(error.message).not.toContain("{serial}");
  });

  it("handles multiple template placeholders", () => {
    const error = new InjectionError(ErrorCode.TIMEOUT, { ms: "5000" });
    expect(error.message).toContain("5000");
    expect(error.message).not.toContain("{ms}");
  });

  it("uses raw template when no context is provided for a templated message", () => {
    const error = new InjectionError(ErrorCode.DEVICE_NOT_FOUND);
    expect(error.message).toContain("{serial}");
  });
});
