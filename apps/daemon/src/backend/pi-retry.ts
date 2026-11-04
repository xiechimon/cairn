export const PI_RETRY_SETTINGS = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2000,
  maxAgentDelayMs: 60000,
  provider: { maxRetries: 0 },
} as const;

export const RETRY_STORM_MAX = PI_RETRY_SETTINGS.maxRetries;
