import {
  CHIEF_REMOTE_TOOLS,
  CHIEF_REPLY_TOOLS,
  CHIEF_ROUTER_TOOLS,
  COMPUTER_DESKTOP_TOOLS,
  COMPUTER_REMOTE_TOOLS,
  COORDINATOR_ATTACH_FILE_TOOL,
  type ComputerTool,
  OWN_COMPUTER_TOOLS,
  PHONE_TOOLS,
  REQUEST_SECRET_TOOL_DEF,
  type RemoteToolDef,
  SLICE1_ACTIONS,
} from '@cairn/shared';

const ACTION_COPY: Record<string, string> = {
  archive_project: 'Archive a project. It stays readable and can be unarchived.',
  unarchive_project: 'Unarchive a project so it can be changed again.',
  delete_project:
    'Ask the owner to approve deleting a project. This call deletes nothing: the server parks an approval card and deletes only when the owner approves it there, and the delete cannot be undone. Tell the owner you are waiting for that approval and end the turn.',
};

const OWNER_CHROME_TOOLS: ReadonlySet<string> = new Set([
  'browser_navigate',
  'browser_snapshot',
  'browser_act',
]);

const OWNER_CHROME_NOTE =
  " This team turned on Browser MCP, so these calls run in the owner's own Chrome, in background tabs of a tab group Cairn opens, with their own sessions already signed in; pass stealth: true when you want the stealth browser instead. The first call may answer that the extension needs Allow, with a six-digit code: tell the owner to click Allow in its popup and end the turn.";

export type CoordinatorComputerToolOffer =
  | { offered: 'always' }
  | { offered: 'when_machine_reports_computer' }
  | { offered: 'when_owner_thread_and_team_has_mac' }
  | { offered: 'when_owner_thread_and_consented_phone' }
  | { withheld: string };

export const COORDINATOR_COMPUTER_TOOL_OFFERS: Record<ComputerTool, CoordinatorComputerToolOffer> =
  {
    shell: {
      withheld: "the Coordinator runs commands on the owner's computer through user_computer_shell",
    },
    list_files: { withheld: 'the Coordinator delegates file work to threads' },
    read_file: { withheld: 'the Coordinator delegates file work to threads' },
    write_file: { withheld: 'the Coordinator delegates file work to threads' },
    attach_file: { offered: 'when_owner_thread_and_team_has_mac' },
    stage_attachment: {
      withheld: 'the server stages uploaded chat attachments internally before a turn starts',
    },
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
    user_computer_shell: { offered: 'when_owner_thread_and_team_has_mac' },
    user_computer_observe: { offered: 'when_owner_thread_and_team_has_mac' },
    user_computer_act: { offered: 'when_owner_thread_and_team_has_mac' },
    phone_observe: { offered: 'when_owner_thread_and_consented_phone' },
    phone_act: { offered: 'when_owner_thread_and_consented_phone' },
    phone_manage: {
      withheld: 'only the owner pairs or forgets a phone from the Computers panel',
    },
  };

export function phoneToolDefs(names: readonly string[]): RemoteToolDef[] {
  const label =
    names.length === 0 ? '' : names.length === 1 ? ` ${names[0]}` : ` (${names.join(', ')})`;
  return PHONE_TOOLS.map((def) => ({
    ...def,
    description: def.description.replace(
      "The owner's real phone",
      `The owner's real phone${label}`,
    ),
  }));
}

function actionToolDefs(): RemoteToolDef[] {
  return SLICE1_ACTIONS.filter(
    (entry) =>
      entry.surfaces.includes('coordinator') &&
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
    ownComputer?: boolean;
    ownerChrome?: boolean;
    phoneComputer?: readonly string[];
  } = {},
): RemoteToolDef[] {
  const browserTools =
    options.ownerChrome === true
      ? COMPUTER_REMOTE_TOOLS.map((def) =>
          OWNER_CHROME_TOOLS.has(def.name)
            ? { ...def, description: `${def.description}${OWNER_CHROME_NOTE}` }
            : def,
        )
      : COMPUTER_REMOTE_TOOLS;
  return [
    ...CHIEF_REMOTE_TOOLS,
    ...(options.routerTools === false ? [] : CHIEF_ROUTER_TOOLS),
    ...CHIEF_REPLY_TOOLS,
    REQUEST_SECRET_TOOL_DEF,
    ...browserTools,
    ...(options.desktopTools === true ? COMPUTER_DESKTOP_TOOLS : []),
    ...(options.ownComputer === true ? [...OWN_COMPUTER_TOOLS, COORDINATOR_ATTACH_FILE_TOOL] : []),
    ...(options.phoneComputer !== undefined && options.phoneComputer.length > 0
      ? phoneToolDefs(options.phoneComputer)
      : []),
    ...actionToolDefs(),
  ];
}
