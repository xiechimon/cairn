import type { RemoteToolDef } from './chief-tools.js';

const str = (description: string) => ({ type: 'string', description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
});
const arr = (items: unknown, description: string) => ({ type: 'array', items, description });
const stealth = {
  type: 'boolean',
  description:
    'Use the stealth browser (CloakBrowser, its own profile and session) instead of the default Chromium. Use it for sites that block automated browsers and for logging in to them; keep the same value for every call on that page.',
};

export const COMPUTER_REMOTE_TOOLS: readonly RemoteToolDef[] = [
  {
    name: 'browser_navigate',
    description:
      'Open a URL in the Coordinator computer browser. The page stays open for later browser_snapshot and browser_act calls.',
    parameters: obj({ url: str('Absolute http(s) URL to open.'), stealth }, ['url']),
  },
  {
    name: 'browser_snapshot',
    description:
      'Read the current page as an accessibility tree with interactive refs (@e1, @e2, …). Prefer this before browser_act.',
    parameters: obj({ stealth }),
    replaySafe: true,
  },
  {
    name: 'browser_act',
    description:
      'Act on the current page using fresh snapshot refs. For passwords use fill_secret with the saved secret name and current website origin. First use asks the owner to approve that website in chat; wait for approval, then take a fresh snapshot and retry. Never send a plaintext password or one-time code. CAPTCHA and second factors use request_takeover.',
    parameters: obj(
      {
        actions: arr(
          obj(
            {
              kind: str(
                'One of click, fill, fill_secret, type, press, hover, select, check, uncheck, scrollintoview.',
              ),
              ref: str('Interactive ref from browser_snapshot, for example @e1.'),
              text: str('Text for fill, type, press or select.'),
              secret: str(
                'Saved workspace secret name for fill_secret; never its value. Use only kind, ref, secret and origin.',
              ),
              origin: str(
                'Exact current website origin for fill_secret, including scheme and port but no path; for example https://example.com.',
              ),
              paths: arr({ type: 'string' }, 'File paths for upload actions when supported.'),
            },
            ['kind'],
          ),
          'Ordered actions to run on the page.',
        ),
        stealth,
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

export const COMPUTER_DESKTOP_TOOLS: readonly RemoteToolDef[] = [
  {
    name: 'computer_observe',
    description:
      'Take a screenshot of the whole Coordinator computer desktop (terminal, dock, every window). Returns the image and its size; computer_act x and y are pixels in the latest screenshot.',
    parameters: obj({}),
    replaySafe: true,
  },
  {
    name: 'computer_act',
    description:
      'Drive the Coordinator computer desktop with the mouse and keyboard, then return a fresh screenshot. Call computer_observe first; x and y are pixels in its latest screenshot. Prefer browser_* tools for web pages.',
    parameters: obj(
      {
        actions: arr(
          obj(
            {
              kind: str('One of click, double_click, move, drag, scroll, type, key, wait.'),
              x: {
                type: 'integer',
                description:
                  'Screenshot x for click, double_click, move, drag start and optional scroll position.',
              },
              y: { type: 'integer', description: 'Screenshot y, paired with x.' },
              to_x: { type: 'integer', description: 'Drag end x.' },
              to_y: { type: 'integer', description: 'Drag end y.' },
              button: str('left (default), right or middle, for click.'),
              direction: str('up, down, left or right, for scroll.'),
              amount: { type: 'integer', description: 'Scroll steps, default 3.' },
              text: str('Text for type.'),
              key: str('xdotool key for key, for example Return, ctrl+l or ctrl+shift+t.'),
              ms: { type: 'integer', description: 'Milliseconds for wait, at most 10000.' },
            },
            ['kind'],
          ),
          'Ordered actions, at most 24.',
        ),
      },
      ['actions'],
    ),
  },
];

export const COMPUTER_HANDOFF_TIMEOUT_MS = 15 * 60_000;
export const TAKEOVER_HANDED_BACK =
  'The owner handed the computer back. Take a fresh browser_snapshot before acting.';
