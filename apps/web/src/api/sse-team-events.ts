export function teamEventInvalidations(
  ev: Record<string, unknown>,
  teamId: string,
): (readonly string[])[] {
  switch (ev.type) {
    case 'todo': {
      const doc = ev.doc as { id: string; latestBuildId?: string | null };
      const keys: (readonly string[])[] = [['schedules'], ['plans']];
      if (typeof doc.latestBuildId === 'string')
        keys.push(['steps', doc.latestBuildId], ['messages', doc.latestBuildId]);
      return keys;
    }
    case 'build': {
      const doc = ev.doc as { id: string; todoId: string };
      return [
        ['steps', doc.id],
        ['todo', doc.todoId],
        ['plans', doc.id],
      ];
    }
    case 'notification':
      return [
        ['chiefThreads', teamId],
        ['chief', teamId],
      ];
    case 'machine_presence':
      return [
        ['machines', teamId],
        ['computers', teamId],
        ['model-routing', teamId],
      ];
    case 'branch_sync': {
      const rec = ev.sync as { buildId: string };
      return [['branchSync', rec.buildId]];
    }
    default:
      return [];
  }
}
