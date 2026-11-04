export function computerQueryKeys(teamId: string | undefined, generation: number) {
  return {
    computers: ['computers', teamId, generation] as const,
    commands: ['computer-commands', teamId, generation] as const,
  };
}
