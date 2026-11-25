import { statSync } from 'node:fs';

export function tailscaleSocketCandidates(platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') {
    return [
      '/var/run/tailscaled.socket',
      '/var/run/tailscaled.sock',
      '/var/run/tailscale/tailscaled.sock',
      '/opt/homebrew/var/run/tailscaled.sock',
      '/opt/homebrew/var/run/tailscaled.socket',
    ];
  }
  if (platform === 'win32') return [];
  return [
    '/var/run/tailscale/tailscaled.sock',
    '/run/tailscale/tailscaled.sock',
    '/var/run/tailscaled.sock',
  ];
}

export function findTailscaleSockets(platform: NodeJS.Platform = process.platform): string[] {
  const found: string[] = [];
  for (const candidate of tailscaleSocketCandidates(platform)) {
    try {
      if (statSync(candidate).isSocket()) found.push(candidate);
    } catch {}
  }
  return found;
}
