export function resumeRefreshDelayMs(resumeExpiresInMs: number): number {
  return resumeExpiresInMs > 0 ? resumeExpiresInMs : 1_000;
}
