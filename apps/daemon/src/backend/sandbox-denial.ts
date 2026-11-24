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

const MAX_REASON_CHARS = 300;
const LINUX_SIGSYS_EXIT_CODE = 128 + 31;

const NESTED_SANDBOX_PATTERNS: readonly RegExp[] = [
  /sandbox initialization failed/i,
  /\b(?:sandbox_init|sandbox_apply)\b/i,
  /\bsandbox-exec:/i,
  /cannot enter sandbox|already sandboxed/i,
  /\bbwrap:.*(?:operation not permitted|permission denied|cannot|failed|no permissions)/i,
];

const EPERM_PATTERNS: readonly RegExp[] = [
  /operation not permitted/i,
  /\bEPERM\b/,
  /\bdeny\([^)]+\)/i,
  /sandbox:.*\bdeny\b/i,
];

const STDOUT_EPERM_LINE = /^[^:\n]{1,240}:\s*.*(?:operation not permitted|\bEPERM\b)/i;

const LINUX_SANDBOX_PATTERNS: readonly RegExp[] = [
  /read-only file system/i,
  /no permissions to creat/i,
  /\bseccomp\b/i,
];

const PERMISSION_DENIED_PATTERN = /permission denied|\bEACCES\b/i;
const ABSOLUTE_PATH_PATTERN = /(?:\/[^\s:'"`<>|;()[\]{}]+)/g;

function cleanLine(line: string): string {
  return line
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_REASON_CHARS);
}

function firstMatchingLine(text: string, patterns: readonly RegExp[]): string | null {
  for (const raw of text.split('\n')) {
    const line = cleanLine(raw);
    if (line === '') continue;
    if (patterns.some((pattern) => pattern.test(line))) return line;
  }
  return null;
}

function deniedPathErrorLine(
  text: string,
  isDeniedPath: ((candidate: string) => boolean) | undefined,
): string | null {
  if (isDeniedPath === undefined) return null;
  for (const raw of text.split('\n')) {
    const line = cleanLine(raw);
    if (line === '' || !PERMISSION_DENIED_PATTERN.test(line)) continue;
    for (const match of line.matchAll(ABSOLUTE_PATH_PATTERN)) {
      const candidate = match[0].replace(/[.,;:]+$/, '');
      if (candidate.length > 1 && isDeniedPath(candidate)) return line;
    }
  }
  return null;
}

export function detectHostShellSandboxDenial(input: SandboxDenialInput): SandboxDenial | null {
  if (input.exitCode === null || input.exitCode === 0) return null;

  const nestedLine =
    firstMatchingLine(input.stderr, NESTED_SANDBOX_PATTERNS) ??
    firstMatchingLine(input.stdout, NESTED_SANDBOX_PATTERNS);
  if (nestedLine !== null) {
    const reason = nestedLine.toLowerCase().includes('bwrap:')
      ? nestedLine
      : cleanLine(`nested sandbox is not allowed inside the host shell sandbox (${nestedLine})`);
    return { reason };
  }

  const epermLine =
    firstMatchingLine(input.stderr, EPERM_PATTERNS) ??
    firstMatchingLine(input.stdout, [STDOUT_EPERM_LINE]);
  if (epermLine !== null) {
    return { reason: epermLine };
  }

  if (input.platform === 'linux') {
    if (input.exitCode === LINUX_SIGSYS_EXIT_CODE) {
      return { reason: 'blocked by seccomp (SIGSYS)' };
    }
    const linuxLine = firstMatchingLine(input.stderr, LINUX_SANDBOX_PATTERNS);
    if (linuxLine !== null) return { reason: linuxLine };
  }

  const deniedPathLine =
    deniedPathErrorLine(input.stderr, input.isDeniedPath) ??
    deniedPathErrorLine(input.stdout, input.isDeniedPath);
  if (deniedPathLine !== null) {
    return { reason: deniedPathLine };
  }

  return null;
}
