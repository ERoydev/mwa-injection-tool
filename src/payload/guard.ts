import { INJECTED_FLAG } from "./constants.js";

export type GuardReason =
  | "already_injected"
  | "not_android"
  | "not_secure_context";

export type GuardResult =
  | { canInject: true }
  | { canInject: false; reason: GuardReason };

export function guard(): GuardResult {
  if (
    INJECTED_FLAG in window &&
    (window as unknown as Record<string, unknown>)[INJECTED_FLAG] === true
  ) {
    return { canInject: false, reason: "already_injected" };
  }

  if (!navigator.userAgent.includes("Android")) {
    return { canInject: false, reason: "not_android" };
  }

  if (!window.isSecureContext) {
    return { canInject: false, reason: "not_secure_context" };
  }

  return { canInject: true };
}
