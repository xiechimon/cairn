// Skeleton: harness page benchmark grader.
// Layer 1 machine judge is implemented per question; Layer 2 is blind pairwise.
// Full implementation lands after #1511-#1514.

export interface PageRun {
  question: string;
  harness: string;
  model: string;
  buildOk: boolean;
  consoleErrors: string[];
  requirements: Record<string, boolean>;
  screenshotPaths: string[];
  wallMs: number;
  inputTokens: number;
  outputTokens: number;
  retries: number;
}

export function machineScore(run: PageRun): number {
  const reqs = Object.values(run.requirements);
  if (reqs.length === 0) return run.buildOk ? 1 : 0;
  const passed = reqs.filter(Boolean).length;
  if (!run.buildOk) return 0;
  return passed / reqs.length;
}

export function costQuality(run: PageRun): number {
  const q = machineScore(run);
  const tokens = run.inputTokens + run.outputTokens;
  if (tokens <= 0) return q;
  return q / (tokens / 1000);
}
