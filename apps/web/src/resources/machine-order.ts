import type { MachineRow } from '../fixtures/records.js';

function machineSortRank(machine: MachineRow, defaultMachineId: string | null): number {
  if (defaultMachineId !== null && machine.id != null && machine.id === defaultMachineId) return 0;
  return machine.online !== false ? 1 : 2;
}

export function orderMachines(
  machines: readonly MachineRow[],
  defaultMachineId: string | null,
): MachineRow[] {
  return [...machines].sort(
    (a, b) => machineSortRank(a, defaultMachineId) - machineSortRank(b, defaultMachineId),
  );
}
