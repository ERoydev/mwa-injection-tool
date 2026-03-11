export enum ErrorCode {
  NO_DEVICE = "NO_DEVICE",
  DEVICE_NOT_FOUND = "DEVICE_NOT_FOUND",
  PORT_FORWARD_FAILED = "PORT_FORWARD_FAILED",
  NO_TABS = "NO_TABS",
  TAB_CONNECT_FAILED = "TAB_CONNECT_FAILED",
  PAYLOAD_EXCEPTION = "PAYLOAD_EXCEPTION",
  PAYLOAD_NOT_FOUND = "PAYLOAD_NOT_FOUND",
  VERIFY_FAILED = "VERIFY_FAILED",
  BUNDLE_TOO_LARGE = "BUNDLE_TOO_LARGE",
  TIMEOUT = "TIMEOUT",
}

export interface ErrorMeta {
  message: string;
  remediation: string;
  retryable: boolean;
}

export const ERROR_META: Record<ErrorCode, ErrorMeta> = {
  [ErrorCode.NO_DEVICE]: {
    message: "No Android devices found",
    remediation:
      "Check USB connection and enable USB debugging in Developer Options",
    retryable: false,
  },
  [ErrorCode.DEVICE_NOT_FOUND]: {
    message: "Device '{serial}' not found",
    remediation: "Run `adb devices` to list available devices",
    retryable: false,
  },
  [ErrorCode.PORT_FORWARD_FAILED]: {
    message: "Could not forward CDP port",
    remediation: "Ensure Chrome is running on the device",
    retryable: true,
  },
  [ErrorCode.NO_TABS]: {
    message: "No debuggable Chrome tabs found",
    remediation: "Open a Solana dApp in Chrome on the device",
    retryable: true,
  },
  [ErrorCode.TAB_CONNECT_FAILED]: {
    message: "Could not connect to tab",
    remediation: "Try closing and reopening Chrome on the device",
    retryable: true,
  },
  [ErrorCode.PAYLOAD_EXCEPTION]: {
    message: "Payload threw: {exception}",
    remediation: "Check payload build or try debug variant",
    retryable: false,
  },
  [ErrorCode.PAYLOAD_NOT_FOUND]: {
    message: "Payload file not found at {path}",
    remediation: "Run `npm run build` first",
    retryable: false,
  },
  [ErrorCode.VERIFY_FAILED]: {
    message: "Wallet registration could not be verified",
    remediation:
      "Injection may have succeeded — check the dApp's wallet picker",
    retryable: false,
  },
  [ErrorCode.BUNDLE_TOO_LARGE]: {
    message: "Bundle {size} bytes exceeds 150 KB",
    remediation: "Audit dependencies for size",
    retryable: false,
  },
  [ErrorCode.TIMEOUT]: {
    message: "Operation timed out after {ms}ms",
    remediation: "Check device connection and Chrome responsiveness",
    retryable: true,
  },
};

export class InjectionError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, context?: Record<string, string>) {
    const meta = ERROR_META[code];
    const message = context
      ? Object.entries(context).reduce(
          (msg, [key, val]) => msg.replace(`{${key}}`, val),
          meta.message,
        )
      : meta.message;
    super(message);
    this.name = "InjectionError";
    this.code = code;
  }
}
