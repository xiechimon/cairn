export function computerQueryKeys(teamId: string | undefined, generation: number) {
  return {
    computers: ['computers', teamId, generation] as const,
    steps: ['computer-steps', teamId, generation] as const,
  };
}
