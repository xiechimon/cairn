import { isAbsolute, relative, resolve, sep } from 'node:path';
import { realpathOfNearest } from '@cairn/shared/realpath-nearest';

export const HOST_SHELL_CREDENTIAL_DIRECTORIES = [
  '.ssh',
  '.gnupg',
  '.aws',
  '.azure',
  '.config/gcloud',
  '.config/gh',
  '.config/glab-cli',
  '.config/hub',
  '.config/stripe',
  '.config/fly',
  '.fly',
  '.config/doctl',
  '.config/op',
  '.config/devin',
  '.config/opencode',
  '.docker',
  '.orbstack',
  '.colima',
  '.lima',
  '.rd',
  '.local/share/containers',
  '.config/containers',
  '.local/share/docker',
  '.local/share/containerd',
  '.local/share/buildkit',
  '.local/share/keyrings',
  '.tmux',
  '.screen',
  '.kube',
  '.password-store',
  '.config/google-chrome',
  '.config/chromium',
  '.config/BraveSoftware',
  '.config/microsoft-edge',
  '.config/vivaldi',
  '.mozilla/firefox',
  '.claude',
  '.codex',
  '.pi',
  '.gemini',
  '.local/share/cairn',
  '.local/share/devin',
  '.local/share/opencode',
  '.terraform.d',
  '.deno',
  '.vercel',
  '.netlify',
  '.cache/huggingface',
];

export const HOST_SHELL_CREDENTIAL_FILES = [
  '.netrc',
  '.git-credentials',
  '.claude.json',
  '.claude.json.backup',
  '.npmrc',
  '.config/npm/npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.cargo/credentials.toml',
  '.cargo/credentials',
  '.pypirc',
  '.vault-token',
  '.1password/agent.sock',
  '.m2/settings.xml',
  '.m2/settings-security.xml',
  '.gradle/gradle.properties',
  '.gem/credentials',
  '.composer/auth.json',
];

export const CONTAINER_SOCKETS = [
  '/var/run/docker.sock',
  '/private/var/run/docker.sock',
  '/run/docker.sock',
  '/run/podman/podman.sock',
];

export function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

const SERVER_PROTOCOL_PORTS: Record<string, number> = {
  'http:': 80,
  'https:': 443,
  'ws:': 80,
  'wss:': 443,
};

export function serverPortOf(url: URL): number | null {
  if (url.hostname === '') return null;
  const port = url.port === '' ? SERVER_PROTOCOL_PORTS[url.protocol] : Number(url.port);
  return port !== undefined && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export function canonicalDeny(path: string): string {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error('Unsafe confinement path');
  return realpathOfNearest(path);
}
