import type { EngineScreenKind, EngineTakeoverLease } from '@cairn/shared';
import { api } from './client.js';

export interface OpenedEngineScreen {
  path: string;
  wsProtocols: string[];
  kind: EngineScreenKind;
  expiresAt: number;
  generation: number;
}

export function acquireEngineTakeover(
  teamId: string,
  stepId: string,
): Promise<EngineTakeoverLease> {
  return api.post<EngineTakeoverLease>(`/api/teams/${teamId}/engine-runs/${stepId}/takeover`, {});
}

export function renewEngineTakeover(
  teamId: string,
  stepId: string,
  leaseId: string,
): Promise<EngineTakeoverLease> {
  return api.patch<EngineTakeoverLease>(`/api/teams/${teamId}/engine-runs/${stepId}/takeover`, {
    leaseId,
  });
}

export function releaseEngineTakeover(
  teamId: string,
  stepId: string,
  leaseId: string,
): Promise<{ released: true }> {
  return api.del<{ released: true }>(`/api/teams/${teamId}/engine-runs/${stepId}/takeover`, {
    leaseId,
  });
}

export function openEngineScreen(
  teamId: string,
  stepId: string,
  body: { kind: EngineScreenKind; leaseId?: string; fromSeq?: number },
): Promise<OpenedEngineScreen> {
  return api.post<OpenedEngineScreen>(`/api/teams/${teamId}/engine-runs/${stepId}/screen`, body);
}

export function engineScreenWsUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
