const SUFFIX_LENGTH = 4;
const NON_ALPHANUMERIC = /[^a-z0-9]/gi;

export interface NamedMachine {
  id?: string | null;
  name: string;
}

export function machineSecondary(
  machine: NamedMachine,
  all: readonly NamedMachine[],
): string | null {
  if (machine.id == null) return null;
  const twins = all.filter((other) => other.id !== machine.id && other.name === machine.name);
  if (twins.length === 0) return null;
  return `#${machine.id.replace(NON_ALPHANUMERIC, '').slice(-SUFFIX_LENGTH)}`;
}

export function machineLabel(machine: NamedMachine, all: readonly NamedMachine[]): string {
  const secondary = machineSecondary(machine, all);
  return secondary === null ? machine.name : `${machine.name} · ${secondary}`;
}

export function MachineName({
  machine,
  all,
}: {
  machine: NamedMachine;
  all: readonly NamedMachine[];
}) {
  const secondary = machineSecondary(machine, all);
  return (
    <>
      {machine.name}
      {secondary !== null && (
        <span data-testid="machine-secondary" className="ml-1.5 text-content-tertiary">
          {secondary}
        </span>
      )}
    </>
  );
}
