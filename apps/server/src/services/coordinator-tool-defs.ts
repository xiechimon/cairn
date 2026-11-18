import {
  CHIEF_REMOTE_TOOLS,
  CHIEF_REPLY_TOOLS,
  CHIEF_ROUTER_TOOLS,
  COMPUTER_DESKTOP_TOOLS,
  COMPUTER_REMOTE_TOOLS,
  COMPUTER_VM_TOOLS,
  type ComputerTool,
  OWN_COMPUTER_TOOLS,
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
  | { offered: 'when_machine_reports_vm_computer' }
  | { offered: 'when_owner_turn_and_own_computer_on' }
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
    desktop_snapshot: { offered: 'when_machine_reports_computer' },
    desktop_act: { offered: 'when_machine_reports_computer' },
    open_path: { withheld: 'host app control waits for its approval gate' },
    launch_app: { withheld: 'host app control waits for its approval gate' },
    browser_navigate: { offered: 'always' },
    browser_snapshot: { offered: 'always' },
    browser_act: { offered: 'always' },
    browser_close_tab: { withheld: 'the server closes a card tab when its step ends' },
    request_takeover: { offered: 'always' },
    install_packages: { offered: 'when_machine_reports_vm_computer' },
    computer_manage: {
      withheld:
        'only the owner stops, updates, recovers or resets the computer from the Computers panel',
    },
    user_computer_shell: { offered: 'when_owner_turn_and_own_computer_on' },
    user_computer_observe: { offered: 'when_owner_turn_and_own_computer_on' },
    user_computer_act: { offered: 'when_owner_turn_and_own_computer_on' },
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
  options: {
    routerTools?: boolean;
    desktopTools?: boolean;
    vmComputer?: boolean;
    ownComputer?: boolean;
  } = {},
): RemoteToolDef[] {
  return [
    ...CHIEF_REMOTE_TOOLS,
    ...(options.routerTools === false ? [] : CHIEF_ROUTER_TOOLS),
    ...CHIEF_REPLY_TOOLS,
    ...COMPUTER_REMOTE_TOOLS,
    ...(options.desktopTools === true ? COMPUTER_DESKTOP_TOOLS : []),
    ...(options.vmComputer === true ? COMPUTER_VM_TOOLS : []),
    ...(options.ownComputer === true ? OWN_COMPUTER_TOOLS : []),
    ...actionToolDefs(),
  ];
}
