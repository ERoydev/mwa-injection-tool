import { guard } from "./guard.js";
import { buildConfig } from "./config.js";
import { registerMwa } from "@solana-mobile/wallet-standard-mobile";
import { INJECTED_FLAG, LOG_PREFIX } from "./constants.js";

interface InjectionResult {
  success: boolean;
  reason: string;
}

export function inject(): InjectionResult {
  const guardResult = guard();

  if (!guardResult.canInject) {
    console.warn(`${LOG_PREFIX} Skipped: ${guardResult.reason}`);
    return { success: false, reason: guardResult.reason };
  }

  try {
    const config = buildConfig();
    registerMwa(config);
    (window as unknown as Record<string, unknown>)[INJECTED_FLAG] = true;
    console.log(`${LOG_PREFIX} Wallet registered successfully`);
    return { success: true, reason: "registered" };
  } catch (e) {
    console.error(`${LOG_PREFIX} Error: ${(e as Error).message}`);
    return { success: false, reason: "error" };
  }
}

export const result = inject();
