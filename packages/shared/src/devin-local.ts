export interface DevinLocalStatus {
  loggedIn: boolean;
  canLogin: boolean;
}

export type DevinLoginFailure =
  | 'no-binary'
  | 'spawn'
  | 'exit'
  | 'timeout'
  | 'cancelled'
  | 'busy'
  | 'no-key';

export type DevinLoginOutcome =
  | { ok: true; key: string }
  | { ok: false; reason: DevinLoginFailure };

const DEVIN_KEY_LINE = /^windsurf_api_key\s*=\s*["']([^"']+)["']\s*$/m;

export function devinKeyFromToml(toml: string): string | null {
  return DEVIN_KEY_LINE.exec(toml)?.[1] ?? null;
}

export function devinCredentialsPath(home: string): string {
  return `${home}/.local/share/devin/credentials.toml`;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0 || Number.isNaN(pa[i]) || Number.isNaN(pb[i])) {
      return Number.isNaN(diff) ? a.localeCompare(b) : diff;
    }
  }
  return 0;
}

export function devinBinaryCandidates(opts: {
  home: string;
  pathEnv: string | undefined;
  managedVersions: readonly string[];
}): string[] {
  const fromPath = (opts.pathEnv ?? '')
    .split(':')
    .filter((dir) => dir !== '')
    .map((dir) => `${dir}/devin`);
  const wellKnown = [
    `${opts.home}/.local/bin/devin`,
    '/opt/homebrew/bin/devin',
    '/usr/local/bin/devin',
  ];
  const managed = [...opts.managedVersions]
    .sort((a, b) => compareVersions(b, a))
    .map((v) => `${opts.home}/.local/share/cairn/agents/devin/${v}/bin/devin`);
  return [...new Set([...fromPath, ...wellKnown, ...managed])];
}
