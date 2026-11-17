import type { MachineCapabilities } from '@cairn/shared';
import { Apple, Microsoft } from '@lobehub/icons';
import { cn } from 'cn';
import { Monitor } from 'lucide-react';
import { createContext, useContext } from 'react';
import {
  type SimpleIcon,
  siAlmalinux,
  siAlpinelinux,
  siArchlinux,
  siCachyos,
  siCentos,
  siDebian,
  siElementary,
  siEndeavouros,
  siFedora,
  siGentoo,
  siKalilinux,
  siLinux,
  siLinuxmint,
  siManjaro,
  siNixos,
  siOpensuse,
  siPopos,
  siRockylinux,
  siUbuntu,
  siVoidlinux,
  siZorin,
} from 'simple-icons';

const SUFFIX_LENGTH = 4;
const NON_ALPHANUMERIC = /[^a-z0-9]/gi;

export interface NamedMachine {
  id?: string | null;
  name: string;
  capabilities?: Pick<MachineCapabilities, 'osPlatform' | 'osDistribution'> | null;
}

export const MachineIdentityContext = createContext<readonly NamedMachine[]>([]);

const DISTRIBUTIONS: Readonly<Record<string, SimpleIcon>> = {
  almalinux: siAlmalinux,
  alpine: siAlpinelinux,
  arch: siArchlinux,
  cachyos: siCachyos,
  centos: siCentos,
  debian: siDebian,
  elementary: siElementary,
  endeavouros: siEndeavouros,
  fedora: siFedora,
  gentoo: siGentoo,
  kali: siKalilinux,
  linuxmint: siLinuxmint,
  manjaro: siManjaro,
  nixos: siNixos,
  opensuse: siOpensuse,
  'opensuse-leap': siOpensuse,
  'opensuse-tumbleweed': siOpensuse,
  pop: siPopos,
  rocky: siRockylinux,
  ubuntu: siUbuntu,
  void: siVoidlinux,
  zorin: siZorin,
};

export function machineOsIdentity(machine: Pick<NamedMachine, 'capabilities'>) {
  const platform = machine.capabilities?.osPlatform;
  if (platform === 'darwin') return { label: 'macOS', Mark: Apple };
  if (platform === 'windows') return { label: 'Windows', Mark: Microsoft };
  if (platform !== 'linux') return null;
  const id = machine.capabilities?.osDistribution;
  const icon =
    (id !== undefined && Object.hasOwn(DISTRIBUTIONS, id) ? DISTRIBUTIONS[id] : undefined) ??
    siLinux;
  return { label: icon.title, path: icon.path };
}

export function MachineIcon({
  machine,
  className,
}: {
  machine: Pick<NamedMachine, 'id' | 'capabilities'>;
  className?: string;
}) {
  const machines = useContext(MachineIdentityContext);
  const known = machine.id == null ? undefined : machines.find((row) => row.id === machine.id);
  const identity = machineOsIdentity({ capabilities: machine.capabilities ?? known?.capabilities });
  return (
    <span
      data-slot="machine-os-icon"
      aria-hidden
      title={identity?.label}
      className={cn('inline-flex size-5 flex-none items-center justify-center', className)}
    >
      {identity === null ? (
        <Monitor aria-hidden className="size-full" />
      ) : identity.Mark !== undefined ? (
        <identity.Mark aria-hidden size="100%" />
      ) : (
        <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className="size-full">
          <path d={identity.path} />
        </svg>
      )}
    </span>
  );
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
  all = [],
  showIcon = true,
  compact = false,
}: {
  machine: NamedMachine;
  all?: readonly NamedMachine[];
  showIcon?: boolean;
  compact?: boolean;
}) {
  const secondary = machineSecondary(machine, all);
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center align-middle',
        compact ? 'gap-1.5' : 'gap-2',
      )}
    >
      {showIcon && <MachineIcon machine={machine} className={compact ? 'size-3.5' : undefined} />}
      <span className="min-w-0 wrap-anywhere">
        {machine.name}
        {secondary !== null && (
          <span className="text-content-tertiary">
            {' · '}
            <span data-testid="machine-secondary">{secondary}</span>
          </span>
        )}
      </span>
    </span>
  );
}
