import type { RemoteToolDef } from './chief-tools.js';
import {
  toolArraySchema as arr,
  toolObjectSchema as obj,
  toolStringSchema as str,
} from './tool-parameters.js';

const stealth = {
  type: 'boolean',
  description:
    'Use the stealth browser (CloakBrowser, its own profile and session) instead of the default Chromium. Use it for sites that block automated browsers and for logging in to them; keep the same value for every call on that page.',
};

export const COMPUTER_REMOTE_TOOLS: readonly RemoteToolDef[] = [
  {
    name: 'browser_navigate',
    description:
      "Open a URL in the Coordinator computer browser. The page stays open for later browser_snapshot and browser_act calls. Use the browser yourself when the owner asks you to open, click or fill something on the web, and for work that needs this browser's logins. The default is Chromium; when a page opens blank, the tool reopens it in the stealth browser and says so, and later calls for that site pass stealth: true. When a site blocks automation (the page closes, goes blank or redirects, or says automated access is forbidden), or to log in to such a site, pass stealth: true. When the stealth browser is blocked too, or its license seats are full, do not retry or work around the block: call request_takeover and name the site.",
    parameters: obj({ url: str('Absolute http(s) URL to open.'), stealth }, ['url']),
  },
  {
    name: 'browser_snapshot',
    description:
      'Read the current page as an accessibility tree with interactive refs (@e1, @e2, …), followed by the page text, which is cut at 12000 characters. Prefer this before browser_act; it lists interactive refs, then the page text ([page text]) to read articles and descriptions from. On long pages, for example a result list beside a detail pane, pass selector to read one element in full instead: a CSS selector for the section (such as the job description pane) or an @ref.',
    parameters: obj({
      selector: str(
        'CSS selector or @ref of one element whose full text to return instead of the page snapshot.',
      ),
      stealth,
    }),
    replaySafe: true,
  },
  {
    name: 'browser_act',
    description:
      "Act on the current page using fresh snapshot refs. For passwords use fill_secret with the saved secret name and current website origin. First use asks the owner to approve that website in chat; wait for approval, then take a fresh snapshot and retry. Never send a plaintext password or one-time code. CAPTCHA and second factors use request_takeover. Find saved credentials with secrets; when none fits, ask the owner to save one on the Secrets settings page. When a step fails (the action did not run, the ref is not in the latest snapshot, the element is covered, or the page is not the target), take a fresh snapshot and try another element, scroll first, or browser_navigate to the link's URL; at most 3 retries in a turn, then report what you tried, where it stuck and which page is open. Ask the owner first with ask_user before sending messages or mail, paying, ordering, changing account settings or deleting.",
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
      'Ask the owner to take over the Coordinator computer for a login, captcha, slider or code. Waits until the owner gives control back, then continue from a fresh browser_snapshot. Pass phone with the phone name to ask the owner to take over a paired phone instead (unlock it or open the secure screen); the call waits for the owner to hand it back.',
    parameters: obj({
      reason: str('Short reason shown to the owner, for example which site needs a login.'),
      phone: str(
        'The phone name exactly as Settings, Computers shows it. Set to hand the phone to the owner instead of the computer.',
      ),
    }),
  },
];

export const COMPUTER_DESKTOP_TOOLS: readonly RemoteToolDef[] = [
  {
    name: 'computer_observe',
    description:
      "Your VM computer, not the user's Mac. Last resort, after page and text tools (browser_snapshot) cannot do the job. Take a screenshot of the whole Coordinator computer desktop (terminal, dock, every window). Returns the image and its size; computer_act x and y are pixels in the latest screenshot. A model that cannot see images gets no screenshot and should call request_takeover instead.",
    parameters: obj({}),
    replaySafe: true,
  },
  {
    name: 'computer_act',
    description:
      "Your VM computer, not the user's Mac. Last resort, after page and text tools (browser_snapshot, browser_act) cannot do the job. Drive the Coordinator computer desktop with the mouse and keyboard, then return a fresh screenshot. Call computer_observe first; x and y are pixels in its latest screenshot. Never use it for web pages. A model that cannot see images gets no screenshot and should call request_takeover when the step needs eyes on the screen.",
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
  {
    name: 'desktop_snapshot',
    description:
      "Your VM computer, not the user's Mac. Read a desktop app's window as an accessibility tree: text with numbered elements in [], no screenshot. Call it without app to list the open apps, then with app (the exact name listed) to read one. Pass query to find elements by text instead of reading the whole window. Prefer it over computer_observe for native apps such as the terminal or the browser window itself; use computer_observe when the tree is empty or you need to see pixels.",
    parameters: obj({
      app: str('App name exactly as the app list shows it, for example lxterminal or chromium.'),
      query: str('Optional text to find instead of reading the whole window.'),
    }),
    replaySafe: true,
  },
  {
    name: 'desktop_act',
    description:
      "Your VM computer, not the user's Mac. Act on one app with element numbers from the latest desktop_snapshot of that app, then return a fresh snapshot. type and key bring the app window to the front first and stop without typing when it cannot be focused. To fill a text field use type; set replaces the whole value and falls back to typing it when the field has no set-value. Prefer browser_* tools for web pages.",
    parameters: obj(
      {
        app: str('App name exactly as desktop_snapshot listed it.'),
        actions: arr(
          obj(
            {
              kind: str('One of click, type, set, key, read, wait.'),
              element: {
                type: 'integer',
                description: 'Element number for click, type, set or read.',
              },
              text: str('Text for type.'),
              value: str('Value for set.'),
              key: str('Key name for key, for example Return, Tab or a.'),
              modifiers: arr({ type: 'string' }, 'ctrl, alt or shift held with the key.'),
              double: { type: 'boolean', description: 'Double-click for click.' },
              button: str('left (default) or right, for click.'),
              property: str(
                'value (default) or text, for read: returns that property of the element.',
              ),
              ms: { type: 'integer', description: 'Milliseconds for wait, at most 10000.' },
            },
            ['kind'],
          ),
          'Ordered actions, at most 24.',
        ),
      },
      ['app', 'actions'],
    ),
  },
];

export const COMPUTER_HANDOFF_TIMEOUT_MS = 15 * 60_000;
export const TAKEOVER_HANDED_BACK =
  'The owner handed the computer back. Take a fresh browser_snapshot before acting.';

export const INSTALL_PACKAGES_TOOL = 'install_packages';

export const SHELL_TOOL_PARAMETERS = obj(
  {
    command: str('Shell command.'),
    cwd: str('Working directory inside the computer home; defaults to the computer home.'),
  },
  ['command'],
);

export const PACKAGES_INSTALLED_PREFIX = 'Installed with the owner approval:';
export const PACKAGES_DECLINED =
  'The owner declined installing these packages. Nothing was installed. Tell the owner and do not ask again unless they want it.';
export const PACKAGES_NOT_ANSWERED =
  'The owner did not answer the install request. Nothing was installed. Stop and tell the owner.';
export const PACKAGES_NO_VM_COMPUTER =
  'Only the Coordinator VM computer can install system packages, and this team has none connected. Nothing was installed.';
