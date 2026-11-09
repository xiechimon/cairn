import type { ComputerRecord } from '@cairn/shared';
import type { MachineRow } from '../fixtures/records.js';

export function desktopControlInstalled(
  machine: MachineRow,
  computer: ComputerRecord | null | undefined,
): boolean {
  return machine.capabilities?.ownComputer === true || computer != null;
}

export function browserCapabilityInstalled(
  machine: MachineRow,
  computer: ComputerRecord | null | undefined,
): boolean {
  return (
    machine.capabilities?.browser === true ||
    machine.capabilities?.computer === true ||
    computer != null
  );
}

export function desktopControlOnline(
  machine: MachineRow,
  computer: ComputerRecord | null | undefined,
): boolean {
  if (machine.online !== true) return false;
  if (computer != null) return computer.machine.online && computer.state !== 'failed';
  return machine.capabilities?.ownComputer === true;
}
