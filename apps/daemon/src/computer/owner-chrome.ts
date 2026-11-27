import {
  isLocalCatalogEntry,
  LOGIN_SIGNALS,
  type LoginForm,
  type LoginSignal,
  mcpCatalogEntry,
} from '@cairn/shared';
import { openStdioToolClient, type StdioToolClient } from '../backend/mcp-stdio-client.js';
import {
  type BrowserToolName,
  type BrowserToolResult,
  clearInputValues,
  LOGIN_DETECTION_SCRIPT,
  PAGE_TEXT_MAX_CHARS,
  PAGE_TEXT_SCRIPT,
  secretField,
} from './browser.js';
import { isCairnPage } from './host-screen-self.js';
import { ComputerRefusal } from './provider.js';

export const OWNER_CHROME_CATALOG_ID = 'browsermcp';
const OWNER_CHROME_TOOL = 'browser';
const OWNER_CHROME_OPEN_TIMEOUT_MS = 300_000;

const PAIRING_MARKER = "Click Allow in the Browser MCP extension's popup";
const NO_EXTENSION_MARKER = 'No browser is connected';
const PAUSED_MARKER = 'The user paused Browser MCP';
const MUTATING_COMMAND = /^(goto|click|fill|type|press|hover|select|check|uncheck|scroll)\b/;

const PAGE_TEXT_TRUNCATED =
  '\n[page text truncated here; the rest of the page is not shown. Call browser_snapshot with selector (a CSS selector or an @ref) to read one section in full]';
const ELEMENT_TEXT_TRUNCATED = '\n[element text truncated]';

export const OWNER_CHROME_PAIRING_NOTE =
  'Cairn is set to work in your own Chrome. The Browser MCP extension in Chrome is asking you to allow it: click Allow in its popup after checking that the code matches the one above. Nothing was opened in another browser.';

export const OWNER_CHROME_NO_EXTENSION =
  'Browser MCP is on in Settings, but no Chrome is connected to it: the extension is not installed, Chrome is closed, or the extension was paused. Install it from the Chrome Web Store link in Settings, then ask again.';

export class OwnerChromeUnavailable extends Error {
  constructor(
    readonly reason: 'not-launchable' | 'start-failed' | 'no-extension',
    message: string,
  ) {
    super(message);
    this.name = 'OwnerChromeUnavailable';
  }
}

export type OwnerChromeAnswer = { text: string; isError: boolean };

export type OwnerChromeCaller = (
  session: string,
  commands: readonly string[],
  options: { timeoutMs: number; signal: AbortSignal },
) => Promise<OwnerChromeAnswer>;

export type OwnerChromeAnswerKind = 'ok' | 'pairing' | 'paused' | 'no-extension' | 'failed';

export function classifyOwnerChromeAnswer(answer: OwnerChromeAnswer): OwnerChromeAnswerKind {
  if (!answer.isError) return 'ok';
  if (answer.text.includes(PAIRING_MARKER)) return 'pairing';
  if (answer.text.includes(NO_EXTENSION_MARKER)) return 'no-extension';
  if (answer.text.includes(PAUSED_MARKER)) return 'paused';
  return 'failed';
}

export interface OwnerChromeRunOptions {
  signal: AbortSignal;
  deadlineAt: number;
  now?: () => number;
  session: string;
  cairnOrigins: readonly string[];
  call?: OwnerChromeCaller | undefined;
}

function launcher(): { command: string; args: readonly string[] } {
  const entry = mcpCatalogEntry(OWNER_CHROME_CATALOG_ID);
  if (entry === undefined || !isLocalCatalogEntry(entry))
    throw new OwnerChromeUnavailable(
      'not-launchable',
      `${OWNER_CHROME_CATALOG_ID} has no launch spec in this Cairn build`,
    );
  return { command: entry.command, args: entry.args };
}

const sessions = new Map<string, Promise<StdioToolClient>>();
const MAX_SESSIONS = 4;

export async function closeOwnerChrome(): Promise<void> {
  const open = [...sessions.values()];
  sessions.clear();
  await Promise.all(open.map((client) => client.then((c) => c.close()).catch(() => {})));
}

function sessionClient(
  session: string,
  callOptions: { timeoutMs: number; signal: AbortSignal },
): Promise<StdioToolClient> {
  const existing = sessions.get(session);
  if (existing !== undefined) {
    sessions.delete(session);
    sessions.set(session, existing);
    return existing;
  }
  const { command, args } = launcher();
  const opened = openStdioToolClient({
    command,
    args,
    timeoutMs: Math.min(OWNER_CHROME_OPEN_TIMEOUT_MS, callOptions.timeoutMs),
    signal: callOptions.signal,
  }).catch((error: unknown) => {
    sessions.delete(session);
    throw new OwnerChromeUnavailable(
      'start-failed',
      `${command} ${args.join(' ')} did not start: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  sessions.set(session, opened);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next();
    if (oldest.done === true) break;
    const stale = sessions.get(oldest.value);
    sessions.delete(oldest.value);
    void stale?.then((client) => client.close()).catch(() => {});
  }
  return opened;
}

function stepTimeout(options: OwnerChromeRunOptions): number {
  const clock = options.now ?? Date.now;
  return Math.max(1_000, options.deadlineAt - clock());
}

const defaultCaller: OwnerChromeCaller = async (session, commands, callOptions) => {
  const client = await sessionClient(session, callOptions);
  try {
    return await client.callTool(OWNER_CHROME_TOOL, { commands: commands.join('\n') }, callOptions);
  } catch (error) {
    sessions.delete(session);
    void client.close().catch(() => {});
    throw error;
  }
};

function callerFor(options: OwnerChromeRunOptions): OwnerChromeCaller {
  return options.call ?? defaultCaller;
}

async function runCommands(
  call: OwnerChromeCaller,
  options: OwnerChromeRunOptions,
  commands: readonly string[],
): Promise<string> {
  const answer = await call(options.session, commands, {
    timeoutMs: stepTimeout(options),
    signal: options.signal,
  });
  const kind = classifyOwnerChromeAnswer(answer);
  if (kind === 'pairing')
    throw new ComputerRefusal(`${answer.text}\n[${OWNER_CHROME_PAIRING_NOTE}]`);
  if (kind === 'no-extension') throw new OwnerChromeUnavailable('no-extension', answer.text);
  if (kind === 'paused')
    throw new ComputerRefusal(
      `${answer.text}. Ask the owner to click Resume in the Browser MCP extension's popup; nothing was opened in another browser.`,
    );
  if (kind === 'failed') {
    const abandonedMutation =
      commands.some((command) => MUTATING_COMMAND.test(command)) &&
      /timed out|abandoned/i.test(answer.text);
    throw new ComputerRefusal(
      answer.text === '' ? 'Browser MCP refused this step' : answer.text,
      abandonedMutation ? 'unknown' : 'not_delivered',
    );
  }
  return answer.text;
}

function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

function capText(text: string, notice: string): string {
  return text.length <= PAGE_TEXT_MAX_CHARS
    ? text
    : text.slice(0, PAGE_TEXT_MAX_CHARS - notice.length) + notice;
}

export function ownerChromeRefs(text: string): string {
  return text.replace(/\[ref=([a-z0-9]+)\]/gi, '[ref=@$1]');
}

const SNAPSHOT_REF = /^[a-zA-Z0-9_-]+$/;

function bareRef(ref: string): string | null {
  const bare = ref.startsWith('@') ? ref.slice(1) : ref;
  return SNAPSHOT_REF.test(bare) ? bare : null;
}

function jsonArg(value: string): string {
  return JSON.stringify(value);
}

function evalCommand(script: string): string {
  return `eval ${jsonArg(script.replace(/\s+/g, ' ').trim())}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.trim().split('\n').at(-1) ?? '');
  } catch {
    return null;
  }
}

function parseLoginSignals(text: string): LoginSignal[] | null {
  const parsed = parseJson(text);
  if (!Array.isArray(parsed)) return null;
  const present = parsed.filter((value): value is string => typeof value === 'string');
  return LOGIN_SIGNALS.filter((signal) => present.includes(signal));
}

async function pageLocation(
  call: OwnerChromeCaller,
  options: OwnerChromeRunOptions,
): Promise<{ title: string; url: string } | null> {
  const answer = await runCommands(call, options, [
    'eval "() => ({ title: document.title, url: location.href })"',
  ]);
  const parsed = parseJson(answer);
  if (parsed === null || typeof parsed !== 'object') return null;
  const { title, url } = parsed as { title?: unknown; url?: unknown };
  if (typeof url !== 'string') return null;
  return { title: typeof title === 'string' ? title : '', url };
}

async function refuseOnCairn(
  call: OwnerChromeCaller,
  options: OwnerChromeRunOptions,
  what: string,
): Promise<void> {
  if (options.cairnOrigins.length === 0) return;
  const page = await pageLocation(call, options);
  if (page === null)
    throw new ComputerRefusal(`${what} refused: the page address could not be read`);
  if (await isCairnPage(page.url, options.cairnOrigins))
    throw new ComputerRefusal(
      `${what} refused: ${page.url} is Cairn itself; the agent browser never opens or operates Cairn, so approvals stay with the owner`,
    );
}

async function refuseSecretField(
  call: OwnerChromeCaller,
  options: OwnerChromeRunOptions,
  ref: string,
): Promise<void> {
  const type = await runCommands(call, options, [`get attr type ${ref}`]);
  const autocomplete = await runCommands(call, options, [`get attr autocomplete ${ref}`]);
  if (secretField(type, autocomplete))
    throw new ComputerRefusal(
      `browser_act refused: @${ref} is a password or one-time code field; use fill_secret for a saved password, or request_takeover for verification`,
    );
}

async function withDetection(
  call: OwnerChromeCaller,
  options: OwnerChromeRunOptions,
  text: string,
): Promise<BrowserToolResult> {
  let answer: string;
  try {
    answer = await runCommands(call, options, [evalCommand(LOGIN_DETECTION_SCRIPT)]);
  } catch (error) {
    if (error instanceof ComputerRefusal)
      return { text: `[login detection unavailable]\n${clearInputValues(text)}` };
    throw error;
  }
  const signals = parseLoginSignals(answer);
  if (signals === null) return { text: `[login detection unavailable]\n${clearInputValues(text)}` };
  if (signals.length === 0) return { text };
  const loginForm: LoginForm = { signals };
  return { text: `[login form: ${signals.join(', ')}]\n${clearInputValues(text)}`, loginForm };
}

const NAVIGATE_PARAMS = /^(https?):\/\/([^\s/?#]+)([/?#].*)?$/i;

function cleanAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const spaced = [...trimmed].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
  });
  if (spaced || !NAVIGATE_PARAMS.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

const ACT_KINDS = new Set([
  'click',
  'fill',
  'type',
  'press',
  'hover',
  'select',
  'check',
  'uncheck',
  'scrollintoview',
]);

export function ownerChromeActionCommands(action: Record<string, unknown>): string[] {
  const kind = typeof action.kind === 'string' ? action.kind : '';
  if (kind === 'fill_secret')
    throw new ComputerRefusal(
      'browser_act fill_secret is refused while the owner’s own Chrome is in use: Browser MCP logs the commands it runs, so a saved password must not go there. Use request_takeover for a password step.',
    );
  if (!ACT_KINDS.has(kind))
    throw new ComputerRefusal(`browser_act does not support ${kind === '' ? 'this action' : kind}`);
  const ref = typeof action.ref === 'string' && action.ref !== '' ? bareRef(action.ref) : null;
  const text = typeof action.text === 'string' ? action.text : undefined;
  switch (kind) {
    case 'press':
      if (text === undefined)
        throw new ComputerRefusal('browser_act press needs text (the key name)');
      return [`press ${jsonArg(text)}`];
    case 'click':
    case 'hover':
    case 'check':
    case 'uncheck':
    case 'scrollintoview':
      if (ref === null)
        throw new ComputerRefusal(`browser_act ${kind} needs a ref from browser_snapshot`);
      if (kind === 'scrollintoview') return [`scroll ${ref}`];
      return [`${kind} ${ref}`];
    case 'type':
      if (ref === null || text === undefined)
        throw new ComputerRefusal('browser_act type needs a ref and text');
      return [`click ${ref}`, `type ${jsonArg(text)}`];
    case 'fill':
      if (ref === null || text === undefined)
        throw new ComputerRefusal('browser_act fill needs a ref and text');
      return [`fill ${ref} ${jsonArg(text)}`];
    case 'select':
      if (ref === null || text === undefined)
        throw new ComputerRefusal('browser_act select needs a ref and the value');
      return [`select ${ref} ${jsonArg(text)}`];
    default:
      throw new ComputerRefusal(`browser_act does not support ${kind}`);
  }
}

const turns = new Map<string, Promise<unknown>>();

export function runOwnerChromeTool(
  tool: BrowserToolName,
  params: Record<string, unknown>,
  options: OwnerChromeRunOptions,
): Promise<BrowserToolResult> {
  const next = () => {
    options.signal.throwIfAborted();
    return runInOwnerTab(tool, params, options);
  };
  const mine = (turns.get(options.session) ?? Promise.resolve()).then(next, next);
  turns.set(options.session, mine);
  const leave = () => {
    if (turns.get(options.session) === mine) turns.delete(options.session);
  };
  mine.then(leave, leave);
  return mine;
}

async function runInOwnerTab(
  tool: BrowserToolName,
  params: Record<string, unknown>,
  options: OwnerChromeRunOptions,
): Promise<BrowserToolResult> {
  const reach = callerFor(options);
  let ran = 0;
  const call: OwnerChromeCaller = async (...request) => {
    const answer = await reach(...request);
    if (!answer.isError && request[1].some((command) => MUTATING_COMMAND.test(command))) ran += 1;
    return answer;
  };
  try {
    return await runOwnerChromeSteps(call, tool, params, options);
  } catch (error) {
    if (error instanceof OwnerChromeUnavailable && ran > 0)
      throw new ComputerRefusal(
        `The owner’s Chrome stopped answering after part of this call had run, so nothing was repeated elsewhere. ${error.message}`,
        'unknown',
      );
    if (error instanceof ComputerRefusal && error.delivery === 'not_delivered' && ran > 0)
      throw new ComputerRefusal(error.message, 'unknown');
    throw error;
  }
}

async function runOwnerChromeSteps(
  call: OwnerChromeCaller,
  tool: BrowserToolName,
  params: Record<string, unknown>,
  options: OwnerChromeRunOptions,
): Promise<BrowserToolResult> {
  if (tool === 'browser_navigate') {
    const url = cleanAddress(params.url);
    if (url === null)
      throw new ComputerRefusal(
        'browser_navigate only accepts well-formed http(s) URLs without spaces or control characters',
      );
    if (options.cairnOrigins.length > 0 && (await isCairnPage(url, options.cairnOrigins)))
      throw new ComputerRefusal(
        `browser_navigate refused: ${url} is Cairn itself; the agent browser never opens or operates Cairn, so approvals stay with the owner`,
      );
    await runCommands(call, options, [`goto ${jsonArg(url)}`]);
    const page = await pageLocation(call, options);
    if (page === null)
      throw new ComputerRefusal(
        'browser_navigate refused: the page address could not be read after opening',
      );
    if (await isCairnPage(page.url, options.cairnOrigins))
      throw new ComputerRefusal(
        `browser_navigate refused: ${page.url} is Cairn itself; the agent browser never opens or operates Cairn, so approvals stay with the owner`,
      );
    const opened = `✓ ${page.title === '' ? page.url : page.title}\n  ${page.url}`;
    return withDetection(call, options, opened);
  }

  if (tool === 'browser_snapshot') {
    await refuseOnCairn(call, options, 'browser_snapshot');
    const selector = typeof params.selector === 'string' ? params.selector.trim() : '';
    if (selector !== '') {
      const ref = selector.startsWith('@') ? bareRef(selector) : null;
      const element = await runCommands(call, options, [`get text ${jsonArg(ref ?? selector)}`]);
      const text = tidy(element);
      return {
        text:
          text === ''
            ? '(element has no text)'
            : capText(clearInputValues(text), ELEMENT_TEXT_TRUNCATED),
      };
    }
    const snapshot = await runCommands(call, options, ['snapshot -i']);
    await refuseOnCairn(call, options, 'browser_snapshot');
    const detected = await withDetection(
      call,
      options,
      ownerChromeRefs(snapshot === '' ? '(empty snapshot)' : snapshot),
    );
    const page = await runCommands(call, options, [evalCommand(PAGE_TEXT_SCRIPT)]);
    const text = typeof parseJson(page) === 'string' ? tidy(parseJson(page) as string) : '';
    return {
      ...detected,
      text:
        detected.text +
        (text === ''
          ? ''
          : `\n\n[page text]\n${capText(clearInputValues(text), PAGE_TEXT_TRUNCATED)}`),
    };
  }

  const actions = Array.isArray(params.actions) ? params.actions : [];
  if (actions.length === 0) throw new ComputerRefusal('browser_act needs a non-empty actions list');
  await refuseOnCairn(call, options, 'browser_act');
  const lines: string[] = [];
  for (const raw of actions) {
    const action =
      raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : { kind: '' };
    const ref = typeof action.ref === 'string' ? bareRef(action.ref) : null;
    if ((action.kind === 'fill' || action.kind === 'type') && ref !== null)
      await refuseSecretField(call, options, ref);
    const answer = await runCommands(call, options, ownerChromeActionCommands(action));
    if (answer !== '') lines.push(answer);
    await refuseOnCairn(call, options, 'browser_act');
  }
  return { text: tidy(lines.join('\n')) };
}
