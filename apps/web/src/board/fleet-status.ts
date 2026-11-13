import type { MachineRow } from '../fixtures/records.js';
import type { TFunc as Translate } from '../i18n/translate.js';

export interface FleetStatus {
  online: number;
  offline: number;
  offlineNames: string[];
}

export function fleetStatus(machines: readonly Pick<MachineRow, 'name' | 'online'>[]): FleetStatus {
  const offlineMachines = machines.filter((machine) => machine.online === false);
  return {
    online: machines.filter((machine) => machine.online === true).length,
    offline: offlineMachines.length,
    offlineNames: offlineMachines.map((machine) => machine.name),
  };
}

export function fleetStatusLine(status: FleetStatus, t: Translate): string | null {
  if (status.offline === 0) return null;
  return t('{online} 台在线 · {offline} 台离线（{names}）', {
    online: status.online,
    offline: status.offline,
    names: status.offlineNames.join('、'),
  });
}

export interface FleetSummary {
  label: string;
  short: string;
  title: string;
  tone: 'online' | 'offline';
}

export function fleetSummary(status: FleetStatus, t: Translate): FleetSummary | null {
  if (status.online + status.offline === 0) return null;
  if (status.offline === 0) {
    const label = t('{online} 台在线', { online: status.online });
    return { label, short: `${status.online}/${status.online}`, title: label, tone: 'online' };
  }
  return {
    label: t('{online} 在线 · {offline} 离线', { online: status.online, offline: status.offline }),
    short: `${status.online}/${status.online + status.offline}`,
    title: fleetStatusLine(status, t) ?? '',
    tone: 'offline',
  };
}

export function machineStateLabel(machine: MachineRow, t: Translate): string {
  if (machine.online !== true) return t('离线');
  const running = machine.runningSteps ?? 0;
  if (running === 0) return t('在线 · 空闲');
  return machine.maxConcurrent != null
    ? t('在线 · {n}/{max} 在跑', { n: running, max: machine.maxConcurrent })
    : t('在线 · {n} 在跑', { n: running });
}
