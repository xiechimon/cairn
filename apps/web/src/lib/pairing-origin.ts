import type { RemoteRoute } from '@cairn/shared';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '::1', '[::1]', '0.0.0.0']);
const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/;
const DOCKER_DEFAULT_BRIDGE = /^172\.17(?:\.\d{1,3}){2}$/;

export interface PairingCandidate {
  origin: string;
  source: 'page' | 'tailnet' | 'lan';
}

function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isLoopbackOrigin(origin: string): boolean {
  const hostname = hostnameOf(origin);
  if (hostname === null) return true;
  return (
    LOOPBACK_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    IPV4_LOOPBACK.test(hostname)
  );
}

function isDockerBridgeOrigin(origin: string): boolean {
  const hostname = hostnameOf(origin);
  return hostname !== null && DOCKER_DEFAULT_BRIDGE.test(hostname);
}

export function pairingCandidates(routes: RemoteRoute[], pageOrigin: string): PairingCandidate[] {
  const candidates: PairingCandidate[] = [];
  const add = (origin: string, source: PairingCandidate['source']) => {
    if (isLoopbackOrigin(origin)) return;
    if (candidates.some((candidate) => candidate.origin === origin)) return;
    candidates.push({ origin, source });
  };
  add(pageOrigin, 'page');
  for (const route of routes.filter((item) => item.kind === 'tailnet')) add(route.url, 'tailnet');
  const lan = routes.filter((item) => item.kind === 'lan');
  for (const route of lan.filter((item) => !isDockerBridgeOrigin(item.url))) add(route.url, 'lan');
  for (const route of lan.filter((item) => isDockerBridgeOrigin(item.url))) add(route.url, 'lan');
  return candidates;
}
