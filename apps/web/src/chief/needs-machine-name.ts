export function needsMachineName(
  machines: readonly { online: boolean }[] | undefined,
  sessionMachineId: string | null | undefined,
): boolean {
  if (machines === undefined) return false;
  return machines.filter((machine) => machine.online).length > 1 && sessionMachineId == null;
}
