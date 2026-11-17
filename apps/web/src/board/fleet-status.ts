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

export function machineStateLabel(machine: MachineRow, t: Translate): string {
  return machine.online === true ? t('在线') : t('离线');
}
