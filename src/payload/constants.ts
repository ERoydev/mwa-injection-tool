export const INJECTED_FLAG = "__MWA_INJECTED__" as const;

export const LOG_PREFIX = "[MWA Inject]" as const;

export const CHAINS = [
  "solana:mainnet",
  "solana:devnet",
  "solana:testnet",
] as const;

export const CDP_TIMEOUT = 10_000;

export const ADB_TIMEOUT = 15_000;
