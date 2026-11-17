import {
  CHIEF_REMOTE_TOOLS,
  CHIEF_REPLY_TOOLS,
  CHIEF_ROUTER_TOOLS,
  COMPUTER_DESKTOP_TOOLS,
  COMPUTER_REMOTE_TOOLS,
  type ComputerTool,
  type RemoteToolDef,
  SLICE1_ACTIONS,
} from '@cairn/shared';

const ACTION_COPY: Record<string, string> = {
  archive_project: 'Archive a project. It stays readable and can be unarchived.',
  unarchive_project: 'Unarchive a project so it can be changed again.',
};

export type CoordinatorComputerToolOffer =
  | { offered: 'always' }
  | { offered: 'when_machine_reports_computer' }
  | { withheld: string };

export const COORDINATOR_COMPUTER_TOOL_OFFERS: Record<ComputerTool, CoordinatorComputerToolOffer> =
  {
    shell: { withheld: 'the Coordinator delegates shell work to threads' },
    list_files: { withheld: 'the Coordinator delegates file work to threads' },
    read_file: { withheld: 'the Coordinator delegates file work to threads' },
    write_file: { withheld: 'the Coordinator delegates file work to threads' },
    attach_file: { withheld: 'the Coordinator attaches files through attachment' },
    computer_observe: { offered: 'when_machine_reports_computer' },
    computer_act: { offered: 'when_machine_reports_computer' },
    open_path: { withheld: 'host app control waits for its approval gate' },
    launch_app: { withheld: 'host app control waits for its approval gate' },
    browser_navigate: { offered: 'always' },
    browser_snapshot: { offered: 'always' },
    browser_act: { offered: 'always' },
    request_takeover: { offered: 'always' },
    user_computer_shell: { withheld: "the owner's own computer waits for its approval gate" },
    user_computer_observe: { withheld: "the owner's own computer waits for its approval gate" },
    user_computer_act: { withheld: "the owner's own computer waits for its approval gate" },
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

export function coordinatorToolDefs(
  options: { routerTools?: boolean; desktopTools?: boolean } = {},
): RemoteToolDef[] {
  return [
    ...CHIEF_REMOTE_TOOLS,
    ...(options.routerTools === false ? [] : CHIEF_ROUTER_TOOLS),
    ...CHIEF_REPLY_TOOLS,
    ...COMPUTER_REMOTE_TOOLS,
    ...(options.desktopTools === true ? COMPUTER_DESKTOP_TOOLS : []),
    ...actionToolDefs(),
  ];
}
