export function machineDisplayName(machine: {
  name: string;
  capabilities?: { computerName?: string; hostname?: string } | null;
}): string {
  const reported = machine.capabilities;
  return reported?.computerName !== undefined && reported.hostname === machine.name
    ? reported.computerName
    : machine.name;
}
