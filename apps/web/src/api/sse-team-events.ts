export function teamEventInvalidations(
  ev: Record<string, unknown>,
  teamId: string,
): (readonly string[])[] {
  switch (ev.type) {
    case 'todo': {
      const doc = ev.doc as { id: string; latestBuildId?: string | null };
      const keys: (readonly string[])[] = [
        ['todos'],
        ['todo', doc.id],
        ['tasks', teamId],
        ['schedules'],
        ['plans'],
      ];
      if (typeof doc.latestBuildId === 'string')
        keys.push(
          ['build', doc.latestBuildId],
          ['steps', doc.latestBuildId],
          ['messages', doc.latestBuildId],
        );
      return keys;
    }
    case 'build': {
      const doc = ev.doc as { id: string; todoId: string };
      return [
        ['build', doc.id],
        ['steps', doc.id],
        ['todos'],
        ['todo', doc.todoId],
        ['tasks', teamId],
        ['plans', doc.id],
      ];
    }
    case 'notification':
      return [
        ['notifications', teamId],
        ['chiefThreads', teamId],
        ['chief', teamId],
        ['todos'],
        ['tasks', teamId],
      ];
    case 'machine_presence':
      return [
        ['machines', teamId],
        ['computers', teamId],
        ['todos'],
        ['tasks', teamId],
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
