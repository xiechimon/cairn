import {
  CHIEF_REMOTE_TOOLS,
  CHIEF_REPLY_TOOLS,
  CHIEF_ROUTER_TOOLS,
  COMPUTER_REMOTE_TOOLS,
  type RemoteToolDef,
  SLICE1_ACTIONS,
} from '@cairn/shared';

const ACTION_COPY: Record<string, string> = {
  archive_project: 'Archive a project. It stays readable and can be unarchived.',
  unarchive_project: 'Unarchive a project so it can be changed again.',
};

function actionToolDefs(): RemoteToolDef[] {
  return SLICE1_ACTIONS.filter(
    (entry) =>
      entry.surfaces.includes('coordinator') &&
      entry.toolName !== 'delete_project' &&
      !CHIEF_REMOTE_TOOLS.some((def) => def.name === entry.toolName),
  ).map((entry) => {
    const description = ACTION_COPY[entry.toolName];
    if (description === undefined) throw new Error(`no Coordinator copy for ${entry.toolName}`);
    return {
      name: entry.toolName,
      description,
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project id' },
        },
        required: ['projectId'],
      },
    };
  });
}

export function coordinatorToolDefs(options: { routerTools?: boolean } = {}): RemoteToolDef[] {
  return [
    ...CHIEF_REMOTE_TOOLS,
    ...(options.routerTools === false ? [] : CHIEF_ROUTER_TOOLS),
    ...CHIEF_REPLY_TOOLS,
    ...COMPUTER_REMOTE_TOOLS,
    ...actionToolDefs(),
  ];
}
