import type { MachineCapabilities } from '../../src/records/machine-capabilities.js';

export function readyMachine<T extends object>(machine: T) {
  const { capabilities, ...fields } = machine as T & {
    capabilities?: MachineCapabilities | null;
  };
  return {
    ...fields,
    capabilities:
      capabilities === null
        ? null
        : {
            mcpServers: [],
            skills: [],
            ...capabilities,
          },
  };
}
