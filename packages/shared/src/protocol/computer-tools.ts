import type { RemoteToolDef } from './chief-tools.js';

const str = (description: string) => ({ type: 'string', description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
});
const arr = (items: unknown, description: string) => ({ type: 'array', items, description });

export const COMPUTER_REMOTE_TOOLS: readonly RemoteToolDef[] = [
  {
    name: 'browser_navigate',
    description:
      'Open a URL in the Coordinator computer browser. The page stays open for later browser_snapshot and browser_act calls.',
    parameters: obj({ url: str('Absolute http(s) URL to open.') }, ['url']),
  },
  {
    name: 'browser_snapshot',
    description:
      'Read the current page as an accessibility tree with interactive refs (@e1, @e2, …). Prefer this before browser_act.',
    parameters: obj({}),
    replaySafe: true,
  },
  {
    name: 'browser_act',
    description:
      'Act on the current page using refs from browser_snapshot. Each action rechecks its ref against a fresh snapshot before running. Supported kinds: click, fill, type, press, hover, select, check, uncheck, scrollintoview.',
    parameters: obj(
      {
        actions: arr(
          obj(
            {
              kind: str(
                'One of click, fill, type, press, hover, select, check, uncheck, scrollintoview.',
              ),
              ref: str('Interactive ref from browser_snapshot, for example @e1.'),
              text: str('Text for fill, type, press or select.'),
              paths: arr({ type: 'string' }, 'File paths for upload actions when supported.'),
            },
            ['kind'],
          ),
          'Ordered actions to run on the page.',
        ),
      },
      ['actions'],
    ),
  },
  {
    name: 'request_takeover',
    description:
      'Ask the owner to take over the Coordinator computer for a login, captcha, slider or code. Waits until the owner gives control back, then continue from a fresh browser_snapshot.',
    parameters: obj({
      reason: str('Short reason shown to the owner, for example which site needs a login.'),
    }),
  },
];

export const COMPUTER_HANDOFF_TIMEOUT_MS = 15 * 60_000;
export const TAKEOVER_HANDED_BACK =
  'The owner handed the computer back. Take a fresh browser_snapshot before acting.';
