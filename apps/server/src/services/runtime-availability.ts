import type { ClaudeCodeReport, MachineCapabilities, MachineRuntime } from '@cairn/shared';

export interface MachineRuntimeFacts {
  claudeCodeReport: Pick<ClaudeCodeReport, 'installed'> | null;
  capabilities: Pick<
    MachineCapabilities,
    'executor' | 'devin' | 'antigravity' | 'doubao' | 'osPlatform' | 'confinement'
  > | null;
}

export function machineRuntimeAvailable(
  machineRow: MachineRuntimeFacts,
  runtime: MachineRuntime,
): boolean {
  if (runtime === 'pi') return true;
  if (runtime === 'gemini') return false;
  if (runtime === 'devin') return machineRow.capabilities?.devin?.installed === true;
  if (runtime === 'antigravity') return machineRow.capabilities?.antigravity?.installed === true;
  if (runtime === 'doubao') return machineRow.capabilities?.doubao?.installed === true;
  return (
    machineRow.claudeCodeReport?.installed === true || machineRow.capabilities?.executor === 'orb'
  );
}
