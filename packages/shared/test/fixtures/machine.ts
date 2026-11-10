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
            confinement: {
              state: 'ready' as const,
              invocation: '11111111-1111-4111-8111-111111111111',
              generation: 1,
              revision: 1,
            },
            ...capabilities,
          },
  };
}
