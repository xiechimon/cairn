export interface SandboxDenial {
  reason: string;
}

export interface SandboxDenialInput {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  platform: string;
  isDeniedPath?: (candidate: string) => boolean;
}

const LINUX_SIGSYS_EXIT_CODE = 128 + 31;

const NESTED_SANDBOX_PATTERNS: readonly RegExp[] = [
  /sandbox initialization failed/i,
  /\b(?:sandbox_init|sandbox_apply)\b/i,
  /\bsandbox-exec:/i,
  /cannot enter sandbox|already sandboxed/i,
  /\bbwrap:(?:(?!\bbwrap:).)*(?:operation not permitted|permission denied|cannot|failed|no permissions)/i,
];

const EPERM_PATTERNS: readonly RegExp[] = [
  /operation not permitted/i,
  /\bEPERM\b/,
  /\bdeny\((?!\))(?:(?!\bdeny\([^)])[^)])+\)/i,
  /sandbox:(?:(?!sandbox:).)*\bdeny\b/i,
];

const LINUX_SANDBOX_PATTERNS: readonly RegExp[] = [
  /read-only file system/i,
  /no permissions to creat/i,
  /\bseccomp\b/i,
];

const PERMISSION_DENIED_PATTERN = /permission denied|\bEACCES\b/i;
const ABSOLUTE_PATH_PATTERN = /(?:\/[^\s:'"`<>|;()[\]{}]+)/g;

function hasMatchingLine(text: string, patterns: readonly RegExp[]): boolean {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (patterns.some((pattern) => pattern.test(line))) return true;
  }
  return false;
}

function hasDeniedPathError(
  text: string,
  isDeniedPath: ((candidate: string) => boolean) | undefined,
): boolean {
  if (isDeniedPath === undefined) return false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || !PERMISSION_DENIED_PATTERN.test(line)) continue;
    for (const match of line.matchAll(ABSOLUTE_PATH_PATTERN)) {
      const candidate = match[0].replace(/(?<![.,;:])[.,;:]+$/, '');
      if (candidate.length > 1 && isDeniedPath(candidate)) return true;
    }
  }
  return false;
}

export function detectHostShellSandboxDenial(input: SandboxDenialInput): SandboxDenial | null {
  if (input.exitCode === null || input.exitCode === 0) return null;

  if (hasMatchingLine(input.stderr, NESTED_SANDBOX_PATTERNS)) {
    return { reason: 'nested sandbox is not allowed inside the host shell sandbox' };
  }

  if (hasMatchingLine(input.stderr, EPERM_PATTERNS)) {
    return { reason: 'operation not permitted by the host shell sandbox (EPERM)' };
  }

  if (input.platform === 'linux') {
    if (input.exitCode === LINUX_SIGSYS_EXIT_CODE) {
      return { reason: 'blocked by seccomp (SIGSYS)' };
    }
    if (hasMatchingLine(input.stderr, LINUX_SANDBOX_PATTERNS)) {
      return { reason: 'blocked by the Linux host shell sandbox' };
    }
  }

  if (hasDeniedPathError(input.stderr, input.isDeniedPath)) {
    return { reason: 'access to a protected path was denied by the host shell sandbox' };
  }

  return null;
}
