import type { NetworkInterfaceInfo } from 'node:os';
import type { RemoteRoute, RemoteRoutesResponse, TailnetAccess, TunnelAccess } from '@cairn/shared';
import { isLoopbackHost } from '../config.js';

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]', '*', '']);
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;
const LINK_LOCAL_PREFIX = '169.254.';
const DOCKER_DEFAULT_BRIDGE_PREFIX = '172.17.';
const DNS_NAME_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

export type InterfaceTable = NodeJS.Dict<NetworkInterfaceInfo[]>;

export interface RouteInputs {
  listenHost: string;
  listenPort: number;
  interfaces: InterfaceTable;
  tailnet: TailnetAccess | null;
  tunnel?: TunnelAccess | null;
}

function lanAddresses(host: string, interfaces: InterfaceTable): string[] {
  if (isLoopbackHost(host)) return [];
  if (!WILDCARD_HOSTS.has(host)) return IPV4_PATTERN.test(host) ? [host] : [];
  const found = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith(LINK_LOCAL_PREFIX)) continue;
      if (entry.address.startsWith(DOCKER_DEFAULT_BRIDGE_PREFIX)) continue;
      found.add(entry.address);
    }
  }
  return [...found].sort();
}

function tailnetUrl(status: TailnetAccess | null): string | null {
  if (status === null || status.state !== 'ready') return null;
  const name = status.dnsName;
  if (name === null || !DNS_NAME_PATTERN.test(name)) return null;
  return `https://${name}`;
}

export function buildRemoteRoutes(
  environmentId: string,
  inputs: RouteInputs,
): RemoteRoutesResponse {
  const routes: RemoteRoute[] = lanAddresses(inputs.listenHost, inputs.interfaces).map(
    (address) => ({ kind: 'lan', url: `http://${address}:${inputs.listenPort}` }),
  );
  const tailnetRoute = tailnetUrl(inputs.tailnet);
  if (tailnetRoute !== null) routes.push({ kind: 'tailnet', url: tailnetRoute });
  const tunnelStatus = inputs.tunnel ?? null;
  if (tunnelStatus !== null && tunnelStatus.state === 'ready' && tunnelStatus.url !== null) {
    routes.push({ kind: 'tunnel', url: tunnelStatus.url });
  }
  const status = inputs.tailnet;
  return {
    environmentId,
    routes,
    tailnet:
      status === null
        ? { enabled: false, state: 'off', dnsName: null, ips: [], authUrl: null, error: null }
        : {
            enabled: status.enabled,
            state: status.state,
            dnsName: status.state === 'ready' ? status.dnsName : null,
            ips: status.state === 'ready' ? status.ips : [],
            authUrl: status.state === 'needs-login' ? status.authUrl : null,
            error: status.state === 'failed' ? status.error : null,
          },
    ...(tunnelStatus !== null
      ? {
          tunnel: {
            enabled: tunnelStatus.enabled,
            state: tunnelStatus.state,
            url: tunnelStatus.state === 'ready' ? tunnelStatus.url : null,
            relayUrl: tunnelStatus.relayUrl,
            error: tunnelStatus.state === 'failed' ? tunnelStatus.error : null,
          },
        }
      : {}),
  };
}
