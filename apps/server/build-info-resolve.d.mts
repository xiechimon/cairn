export interface ResolveBuildVersionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  gitDescribeExact?: () => string;
}

export function resolveBuildVersion(opts?: ResolveBuildVersionOptions): string | null;
