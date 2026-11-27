export function resolveDevinBin(env?: NodeJS.ProcessEnv): string;
export function laneEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function scrubDiagnostics(raw: string, extraPaths?: string[]): string;
export function checkDevinAuth(options?: {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): { ok: boolean; bin: string; exitCode: number; detail: string };
