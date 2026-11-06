import type { RemoteRoute } from '@cairn/shared';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '::1', '[::1]', '0.0.0.0']);
const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/;

export function isLoopbackOrigin(origin: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return true;
  }
  return (
    LOOPBACK_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    IPV4_LOOPBACK.test(hostname)
  );
}

export function pairingOrigin(routes: RemoteRoute[], pageOrigin: string): string | null {
  const preferred =
    routes.find((route) => route.kind === 'tailnet') ??
    routes.find((route) => route.kind === 'lan');
  const origin = preferred?.url ?? pageOrigin;
  return isLoopbackOrigin(origin) ? null : origin;
}
