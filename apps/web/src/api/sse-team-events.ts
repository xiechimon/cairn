export function teamEventInvalidations(
  ev: Record<string, unknown>,
  teamId: string,
): (readonly string[])[] {
  switch (ev.type) {
    case 'todo': {
      const doc = ev.doc as { id: string };
      return [['todos'], ['todo', doc.id], ['schedules'], ['plans']];
    }
    case 'build': {
      const doc = ev.doc as { id: string; todoId: string };
      return [
        ['build', doc.id],
        ['steps', doc.id],
        ['todos'],
        ['todo', doc.todoId],
        ['plans', doc.id],
      ];
    }
    case 'notification':
      return [['notifications', teamId], ['chiefThreads', teamId], ['todos']];
    case 'machine_presence':
      return [['machines', teamId], ['todos']];
    case 'branch_sync': {
      const rec = ev.sync as { buildId: string };
      return [['branchSync', rec.buildId]];
    }
    default:
      return [];
  }
}
