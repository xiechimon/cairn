import type { ComputerControlLease, ComputerRecord, ComputerScreenKind } from '@cairn/shared';
import { api } from './client.js';

export interface OpenedComputerScreen {
  path: string;
  wsProtocols: string[];
  kind: ComputerScreenKind;
  expiresAt: number;
  generation: number;
}

export function openComputerScreen(
  teamId: string,
  computerId: string,
  body: { kind: ComputerScreenKind; leaseId?: string },
): Promise<OpenedComputerScreen> {
  return api.post<OpenedComputerScreen>(
    `/api/teams/${teamId}/computers/${computerId}/screen`,
    body,
  );
}

export function acquireComputerControl(
  teamId: string,
  computerId: string,
): Promise<ComputerControlLease> {
  return api.post<ComputerControlLease>(`/api/teams/${teamId}/computers/${computerId}/control`, {});
}

export function renewComputerControl(
  teamId: string,
  computerId: string,
  leaseId: string,
): Promise<ComputerControlLease> {
  return api.patch<ComputerControlLease>(`/api/teams/${teamId}/computers/${computerId}/control`, {
    leaseId,
  });
}

export function releaseComputerControl(
  teamId: string,
  computerId: string,
  leaseId: string,
): Promise<{ released: true }> {
  return api.del<{ released: true }>(`/api/teams/${teamId}/computers/${computerId}/control`, {
    leaseId,
  });
}

export function computerScreenWsUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function patchComputerBrowser(
  computerId: string,
  browserEnabled: boolean,
): Promise<{ computer: ComputerRecord }> {
  return api.patch<{ computer: ComputerRecord }>(`/api/computers/${computerId}`, {
    browserEnabled,
  });
}

export function ensureComputerBrowser(
  machineId: string,
  browserEnabled: boolean,
): Promise<{ computer: ComputerRecord }> {
  return api.post<{ computer: ComputerRecord }>('/api/computers', {
    machineId,
    browserEnabled,
  });
}
