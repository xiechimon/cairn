import type { DesktopHostBridge, DesktopHostStatus } from '../desktop-shell.js';

export interface ParsedRemoteHost {
  origin: string;
  defaultName: string;
}

const IPV4_HOST = /^\d+(?:\.\d+){3}$/;

export function parseRemoteHostOrigin(raw: string): ParsedRemoteHost | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname;
  if (host === '') return null;
  const defaultName =
    IPV4_HOST.test(host) || host.includes(':') ? host : host.split('.')[0] || host;
  return { origin: parsed.origin, defaultName };
}

export async function addAndSwitchRemoteHost(
  bridge: DesktopHostBridge,
  input: { url: string; name?: string },
): Promise<DesktopHostStatus | null> {
  const parsed = parseRemoteHostOrigin(input.url);
  if (parsed === null) throw new Error('Invalid remote host URL');
  const trimmedName = input.name?.trim() ?? '';
  const name = trimmedName === '' ? parsed.defaultName : trimmedName;
  const status = await bridge.addRemote({ name, url: parsed.origin });
  const target = status?.connections.find(
    (conn) => conn.kind === 'remote' && conn.url === parsed.origin,
  );
  if (target === undefined) return status;
  return bridge.switch(target.id);
}
