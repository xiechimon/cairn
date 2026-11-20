export function teamEventInvalidations(
  ev: Record<string, unknown>,
  teamId: string,
): (readonly string[])[] {
  switch (ev.type) {
    case 'todo': {
      const doc = ev.doc as { id: string; latestBuildId?: string | null };
      const keys: (readonly string[])[] = [['schedules'], ['plans'], ['design', doc.id]];
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
        ['design', doc.todoId],
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
    default:
      return [];
  }
}
