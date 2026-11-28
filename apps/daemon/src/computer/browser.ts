import { setTimeout as sleep } from 'node:timers/promises';
import {
  browserSecretFillActionSchema,
  type ComputerCall,
  escapeRegExp,
  LOGIN_SIGNALS,
  type LoginForm,
  type LoginSignal,
  normalizeBrowserSecretOrigin,
} from '@cairn/shared';
import { z } from 'zod';
import { cairnBlockPatterns, isCairnPage } from './host-screen-self.js';
import type { ComputerProcessEvent, ComputerProvider } from './provider.js';
import { ComputerRefusal } from './provider.js';

export const AGENT_BROWSER_BINARY = 'agent-browser';
export const AGENT_BROWSER_SESSION = 'cairn';
const AGENT_CURSOR_DWELL_MS = 650;
const AGENT_CURSOR_DWELL_HEADROOM_MS = 2_000;
export const AGENT_CURSOR_INIT_PATH = '.cairn/agent-cursor.js';
const TYPING_PAUSE_MS = 90;
const TYPING_MAX_BURSTS = 24;
const TYPING_STEP_COST_MS = 400;
const ADDRESS_BAR_TYPING_MS = 2_500;
const ADDRESS_BAR_SETTLE_MS = 300;

function typingBursts(text: string): string[] {
  const characters = Array.from(text);
  const size = Math.max(1, Math.ceil(characters.length / TYPING_MAX_BURSTS));
  const bursts: string[] = [];
  for (let start = 0; start < characters.length; start += size) {
    bursts.push(characters.slice(start, start + size).join(''));
  }
  return bursts;
}

const navigateParams = z.object({
  url: z.string().min(1).max(8_192),
});

const actKindSchema = z.enum([
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

const actActionSchema = z.object({
  kind: actKindSchema,
  ref: z.string().min(1).max(64).optional(),
  text: z.string().max(100_000).optional(),
  paths: z.array(z.string().max(4096)).max(16).optional(),
});

const actParams = z.object({
  actions: z
    .array(z.union([actActionSchema, browserSecretFillActionSchema]))
    .min(1)
    .max(32),
});

export type BrowserToolName = 'browser_navigate' | 'browser_snapshot' | 'browser_act';

export interface BrowserToolResult {
  text: string;
  loginForm?: LoginForm;
  automationBlocked?: true;
}

export const AUTO_STEALTH_NOTE =
  'The default browser got a blank anti-automation page here, so Cairn opened this address in the stealth browser. Pass stealth: true on the following browser calls for this site.';

export const PAGE_TEXT_MAX_CHARS = 12_000;
export const PAGE_TEXT_SCRIPT = "document.body ? document.body.innerText : ''";
const PAGE_TEXT_TRUNCATED =
  '\n[page text truncated here; the rest of the page is not shown. Call browser_snapshot with selector (a CSS selector or an @ref) to read one section in full]';
const ELEMENT_TEXT_TRUNCATED = '\n[element text truncated]';

function tidyText(raw: string): string {
  return raw
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

export function pageTextSection(output: string): string {
  let result: unknown;
  try {
    result = (JSON.parse(output) as { data?: { result?: unknown } } | null)?.data?.result;
  } catch {
    return '';
  }
  if (typeof result !== 'string') return '';
  const text = tidyText(result);
  if (text === '') return '';
  return `\n\n[page text]\n${capText(text, PAGE_TEXT_TRUNCATED)}`;
}

export function elementTextSection(output: string): string {
  let result: unknown;
  try {
    result = (JSON.parse(output) as { data?: { text?: unknown } } | null)?.data?.text;
  } catch {
    return '';
  }
  if (typeof result !== 'string') return '';
  return capText(tidyText(result), ELEMENT_TEXT_TRUNCATED);
}

export function isAutomationBlankSnapshot(text: string): boolean {
  return text.includes('(no interactive elements)') && !text.includes('[ref=');
}

const CHALLENGE_HOSTS = [
  'hcaptcha.com',
  'challenges.cloudflare.com',
  'geetest.com',
  'arkoselabs.com',
  'funcaptcha.com',
  'captcha.qq.com',
  'recaptcha.net',
];

export const LOGIN_DETECTION_SCRIPT = `(() => {
  const shown = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const tokens = ['current-password', 'new-password', 'one-time-code', 'username'];
  const challengeHosts = ${JSON.stringify(CHALLENGE_HOSTS)};
  const found = new Set();
  for (const input of document.querySelectorAll('input')) {
    if (!shown(input)) continue;
    if (input.type === 'password') found.add('password');
    const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase().split(/\\s+/);
    for (const token of tokens) if (autocomplete.includes(token)) found.add(token);
  }
  for (const frame of document.querySelectorAll('iframe')) {
    if (!shown(frame)) continue;
    let url;
    try { url = new URL(frame.src, location.href); } catch { continue; }
    const host = url.hostname;
    const challenge = challengeHosts.some((known) => host === known || host.endsWith('.' + known))
      || (host.endsWith('google.com') && url.pathname.startsWith('/recaptcha'));
    if (challenge) found.add('challenge');
  }
  return [...found];
})()`;

export type AgentCursorKind = 'click' | 'point';

const DRAW_AGENT_CURSOR = `function (x, y, kind) {
  const ns = 'http://www.w3.org/2000/svg';
  const host = document.body || document.documentElement;
  let cursor = document.getElementById('__cairnAgentCursor');
  if (cursor && kind === 'rest') return true;
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.id = '__cairnAgentCursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.cssText = 'all:initial;position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:flex;align-items:flex-start;gap:2px;transition:transform 420ms cubic-bezier(.2,.8,.2,1);will-change:transform;';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '26');
    svg.setAttribute('height', '26');
    svg.setAttribute('viewBox', '0 0 22 22');
    svg.style.cssText = 'all:initial;pointer-events:none;display:block;flex:none;width:26px;height:26px;margin:0;overflow:visible;';
    const arrow = document.createElementNS(ns, 'path');
    arrow.setAttribute('d', 'M3 2 L18 10.5 L11.2 12 L7.9 18.6 Z');
    arrow.setAttribute('fill', '#1a1a1a');
    arrow.setAttribute('stroke', '#ffffff');
    arrow.setAttribute('stroke-width', '1.6');
    arrow.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(arrow);
    const label = document.createElement('span');
    label.textContent = 'Coordinator';
    label.style.cssText = 'all:initial;pointer-events:none;margin-top:18px;padding:2px 7px;border-radius:999px;background:#d97757;color:#ffffff;font:500 11px/16px -apple-system,system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.25);';
    cursor.append(svg, label);
    const startX = kind === 'rest' ? x : Math.round(window.innerWidth / 2);
    const startY = kind === 'rest' ? y : Math.round(window.innerHeight / 2);
    cursor.style.transform = 'translate(' + (startX - 3) + 'px, ' + (startY - 2) + 'px)';
    host.appendChild(cursor);
    void cursor.offsetWidth;
  }
  if (kind === 'rest') return true;
  cursor.style.transform = 'translate(' + (x - 3) + 'px, ' + (y - 2) + 'px)';
  try {
    sessionStorage.setItem('__cairnAgentCursor', JSON.stringify({ x: x, y: y }));
  } catch {}
  if (kind === 'click') {
    const ring = document.createElement('div');
    ring.setAttribute('aria-hidden', 'true');
    ring.style.cssText = 'all:initial;pointer-events:none;opacity:0;position:fixed;width:28px;height:28px;border-radius:50%;border:2px solid #d97757;z-index:2147483646;left:' + (x - 14) + 'px;top:' + (y - 14) + 'px;';
    host.appendChild(ring);
    ring.animate([{ transform: 'scale(.4)', opacity: 1 }, { transform: 'scale(1.7)', opacity: 0 }], { duration: 650, delay: 380, easing: 'ease-out' });
    setTimeout(() => ring.remove(), 1200);
  }
  return true;
}`;

export const AGENT_CURSOR_INIT_SCRIPT = `(() => {
  if (window.top !== window) return;
  const draw = ${DRAW_AGENT_CURSOR};
  const show = () => {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem('__cairnAgentCursor') || 'null');
    } catch {}
    const known = saved !== null && typeof saved === 'object' && Number.isFinite(saved.x) && Number.isFinite(saved.y);
    draw(
      known ? saved.x : Math.round(window.innerWidth / 2),
      known ? saved.y : Math.round(window.innerHeight / 2),
      'rest',
    );
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
  else show();
})();`;

export function agentCursorScript(x: number, y: number, kind: AgentCursorKind): string {
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw new Error('cursor needs finite coordinates');
  return `(${DRAW_AGENT_CURSOR})(${Math.round(x)}, ${Math.round(y)}, ${JSON.stringify(kind)})`;
}

const cursorBoxSchema = z.object({
  data: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
});

const SECRET_AUTOCOMPLETE = new Set(['current-password', 'new-password', 'one-time-code']);

export function secretField(type: string, autocomplete: string): boolean {
  if (type.trim().toLowerCase() === 'password') return true;
  return autocomplete
    .toLowerCase()
    .split(/\s+/)
    .some((token) => SECRET_AUTOCOMPLETE.has(token));
}

const INPUT_VALUE_LINE =
  /^(\s*- (?:textbox|searchbox|combobox|spinbutton|slider)\b(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]*\])?(?: [a-z-]+ \[[^\]]*\])?): .*$/;

export function clearInputValues(snapshot: string): string {
  return snapshot
    .split('\n')
    .map((line) => line.replace(INPUT_VALUE_LINE, '$1: [value cleared]'))
    .join('\n');
}

function parseLoginSignals(output: string): LoginSignal[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  const result = (parsed as { data?: { result?: unknown } } | null)?.data?.result;
  if (!Array.isArray(result)) return null;
  return LOGIN_SIGNALS.filter((signal) => result.includes(signal));
}

export interface BrowserRunOptions {
  signal: AbortSignal;
  session?: string;
  browserScope?: string;
  tabScope?: string;
  binary?: string;
  headless?: boolean;
  deadlineAt?: number;
  timeoutMs?: number;
  now?: () => number;
  cairnOrigins: readonly string[];
  browserSecrets?: ComputerCall['browserSecrets'];
  isCairnPage?: (url: string, cairnOrigins: readonly string[]) => Promise<boolean>;
}

const CAIRN_PAGE_REFUSAL =
  'is Cairn itself; the agent browser never opens or operates Cairn, so approvals stay with the owner';

export const STEALTH_SESSION_SUFFIX = '-stealth';

const SCOPE_TAB_PREFIX = 'cairn-';
const CARD_TAB_PREFIX = `${SCOPE_TAB_PREFIX}card-`;
const COORDINATOR_TAB_LABEL = `${SCOPE_TAB_PREFIX}coordinator`;
export const CARD_TAB_IDLE_MS = 30 * 60_000;

const scopeTabUse = new Map<string, number>();

function scopeTabLabel(tabScope: string): string {
  return `${SCOPE_TAB_PREFIX}${tabScope.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 64)}`;
}

function scopeTabKey(session: string, label: string): string {
  return `${session}\u0000${label}`;
}

interface BrowserTab {
  label: string | null;
  targetId: string | null;
  active: boolean;
}

function parseTabList(output: string): BrowserTab[] | null {
  try {
    const tabs = (
      JSON.parse(output.trim().split('\n').at(-1) ?? '') as {
        data?: { tabs?: { active?: unknown; label?: unknown; targetId?: unknown }[] };
      }
    ).data?.tabs;
    if (!Array.isArray(tabs)) return null;
    return tabs.map((tab) => ({
      label: typeof tab.label === 'string' ? tab.label : null,
      targetId: typeof tab.targetId === 'string' ? tab.targetId : null,
      active: tab.active === true,
    }));
  } catch {
    return null;
  }
}

export function browserSessionName(scopeKey: string | undefined, stealth = false): string {
  const cleaned = (scopeKey ?? '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|(?<!_)_+$/g, '')
    .slice(0, 64)
    .replace(/(?:-stealth)+$/i, '')
    .replace(/^[-_]+|(?<![-_])[-_]+$/g, '');
  const base = cleaned.length > 0 ? cleaned : AGENT_BROWSER_SESSION;
  return stealth ? `${base}${STEALTH_SESSION_SUFFIX}` : base;
}

export const PROFILED_SESSION_PREFIX = 'p_';

export function browserScopedSessionName(browserScope: string, stealth = false): string {
  return `${PROFILED_SESSION_PREFIX}${browserSessionName(browserScope, stealth)}`;
}

export function browserProfileKeyOfSession(session: string): string | null {
  if (!session.startsWith(PROFILED_SESSION_PREFIX)) return null;
  const body = session.slice(PROFILED_SESSION_PREFIX.length);
  return body.endsWith(STEALTH_SESSION_SUFFIX)
    ? body.slice(0, -STEALTH_SESSION_SUFFIX.length)
    : body;
}

export function browserSessionFor(
  options: Pick<BrowserRunOptions, 'browserScope' | 'session'>,
  stealth = false,
): string {
  return options.browserScope === undefined
    ? browserSessionName(options.session, stealth)
    : browserScopedSessionName(options.browserScope, stealth);
}

export function isStealthBrowserCommand(argv: readonly string[]): boolean {
  if (argv[0] !== AGENT_BROWSER_BINARY) return false;
  const index = argv.indexOf('--session');
  return index > 0 && (argv[index + 1] ?? '').endsWith(STEALTH_SESSION_SUFFIX);
}

function sessionFlag(session: string): string[] {
  return ['--session', session];
}

function windowFlags(headless: boolean): string[] {
  return headless ? ['--headed', 'false'] : ['--headed'];
}

function bareRef(ref: string): string {
  return ref.startsWith('@') ? ref.slice(1) : ref;
}

function normalizeRef(ref: string): string {
  return `@${bareRef(ref)}`;
}

function browserDeadlineAt(options: BrowserRunOptions): number {
  const clock = options.now ?? Date.now;
  if (options.deadlineAt !== undefined) return options.deadlineAt;
  if (options.timeoutMs !== undefined) return clock() + options.timeoutMs;
  throw new ComputerRefusal('browser call needs a deadline', 'not_delivered');
}

function remainingTimeoutMs(deadlineAt: number, now: () => number): number {
  return Math.max(0, deadlineAt - now());
}

async function collectExecute(
  provider: ComputerProvider,
  argv: readonly string[],
  options: BrowserRunOptions & { deadlineAt: number },
  started: boolean,
  stdin?: string,
): Promise<{ text: string; code: number | null }> {
  const clock = options.now ?? Date.now;
  const timeoutMs = remainingTimeoutMs(options.deadlineAt, clock);
  if (timeoutMs <= 0) {
    refuse('browser call deadline elapsed', started);
  }
  const events = await provider.execute({
    argv: [...argv],
    timeoutMs,
    signal: options.signal,
    ...(stdin === undefined ? {} : { stdin }),
  });
  let text = '';
  let code: number | null = null;
  for await (const event of events as AsyncIterable<ComputerProcessEvent>) {
    if (event.kind === 'stdout' || event.kind === 'stderr') text += event.text;
    else if (event.kind === 'exit') code = event.code;
  }
  return { text: text.trim(), code };
}

function actionArgv(action: z.infer<typeof actActionSchema>): string[] {
  if (action.ref !== undefined && !/^[a-zA-Z0-9_-]+$/.test(action.ref.replace(/^@/, '')))
    throw new ComputerRefusal(`browser_act ${action.kind} needs a ref from browser_snapshot`);
  const ref = action.ref !== undefined ? normalizeRef(action.ref) : undefined;
  switch (action.kind) {
    case 'click':
    case 'hover':
    case 'check':
    case 'uncheck':
    case 'scrollintoview':
      if (ref === undefined) {
        throw new ComputerRefusal(`browser_act ${action.kind} needs a ref from browser_snapshot`);
      }
      return [action.kind, ref];
    case 'fill':
    case 'type':
    case 'select':
      if (ref === undefined) {
        throw new ComputerRefusal(`browser_act ${action.kind} needs a ref from browser_snapshot`);
      }
      if (action.text === undefined) {
        throw new ComputerRefusal(`browser_act ${action.kind} needs text`);
      }
      return [action.kind, ref, action.text];
    case 'press':
      if (action.text === undefined) {
        throw new ComputerRefusal('browser_act press needs text (the key name)');
      }
      return ['press', action.text];
    default: {
      const _exhaustive: never = action.kind;
      throw new ComputerRefusal(`browser_act does not support ${_exhaustive}`);
    }
  }
}

function refPresent(snapshot: string, ref: string): boolean {
  const escaped = escapeRegExp(bareRef(ref));
  return new RegExp(`[[ ]ref=${escaped}[\\],]`).test(snapshot);
}

function sameSite(target: string, href: string): boolean {
  const host = (value: string) => {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  };
  const want = host(target);
  const got = host(href);
  if (want === null || got === null) return false;
  return got === want || got.endsWith(`.${want}`) || want.endsWith(`.${got}`);
}

function refuse(message: string, started: boolean): never {
  throw new ComputerRefusal(message, started ? 'unknown' : 'not_delivered');
}

const secretAssignLine = (target: string, value: string) =>
  `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(${target}, ${JSON.stringify(value)});
    ${target}.dispatchEvent(new Event('input', { bubbles: true }));
    ${target}.dispatchEvent(new Event('change', { bubbles: true }));`;

export function browserSecretFillScript(
  origin: string,
  value?: string,
  username?: string | null,
): string {
  return `(() => { 'use strict';
    if (window.top !== window || location.origin !== ${JSON.stringify(origin)}) return false;
    const input = document.activeElement;
    if (!(input instanceof HTMLInputElement) || input.ownerDocument !== document || input.type !== 'password' || input.disabled || input.readOnly) return false;
    const tokens = input.autocomplete.toLowerCase().split(/\\s+/);
    if (tokens.includes('new-password') || tokens.includes('one-time-code')) return false;
    const box = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    if (box.width <= 0 || box.height <= 0 || style.visibility !== 'visible' || style.display === 'none') return false;
    const form = input.form;
    if (form && new URL(form.action, location.href).origin !== location.origin) return false;
    if (form) for (const submit of document.querySelectorAll('[formaction]')) {
      if (submit.form === form && new URL(submit.formAction, location.href).origin !== location.origin) return false;
    }
    ${
      username === undefined
        ? ''
        : `let login = null;
    const candidates = (input.form && input.form.elements) || document.querySelectorAll('input');
    for (const el of candidates) {
      if (!(el instanceof HTMLInputElement) || el === input || el.ownerDocument !== document || el.disabled || el.readOnly) continue;
      const kind = (el.type || 'text').toLowerCase();
      if (kind !== 'text' && kind !== 'email' && kind !== 'tel') continue;
      const elBox = el.getBoundingClientRect();
      const elStyle = getComputedStyle(el);
      if (elBox.width <= 0 || elBox.height <= 0 || elStyle.visibility !== 'visible' || elStyle.display === 'none') continue;
      const elTokens = String(el.autocomplete || '').toLowerCase().split(/\\s+/);
      if (elTokens.includes('new-password') || elTokens.includes('one-time-code') || elTokens.includes('current-password')) continue;
      if (elTokens.includes('username')) { login = el; break; }
      if (login === null && input.form !== null) login = el;
    }
    if (login === null) return false;
    ${typeof username === 'string' ? secretAssignLine('login', username) : ''}`
    }
    ${value === undefined ? '' : secretAssignLine('input', value)}
    return true;
  })()`;
}

export async function runBrowserTool(
  provider: ComputerProvider,
  tool: BrowserToolName,
  params: Record<string, unknown>,
  options: BrowserRunOptions,
): Promise<BrowserToolResult> {
  const binary = options.binary ?? AGENT_BROWSER_BINARY;
  const headless = options.headless === true;
  const stealth = !headless && params.stealth === true;
  const session = browserSessionFor(options, stealth);
  const deadlineAt = browserDeadlineAt(options);
  const timed = { ...options, deadlineAt };
  const cursorScriptWritten =
    stealth || headless
      ? false
      : await provider
          .writeFile(AGENT_CURSOR_INIT_PATH, AGENT_CURSOR_INIT_SCRIPT, {
            timeoutMs: remainingTimeoutMs(deadlineAt, options.now ?? Date.now),
            signal: options.signal,
          })
          .then(
            () => true,
            () => false,
          );
  const prefix = [
    binary,
    ...sessionFlag(session),
    ...windowFlags(headless),
    ...(cursorScriptWritten ? ['--init-script', AGENT_CURSOR_INIT_PATH] : []),
  ];
  let started = false;

  const execute = async (argv: readonly string[]) => {
    const result = await collectExecute(provider, argv, timed, started);
    started = true;
    return result;
  };
  const read = (argv: readonly string[]) => collectExecute(provider, argv, timed, started);

  const humanType = async (
    kind: 'fill' | 'type',
    ref: string,
    text: string,
    argv: string[],
  ): Promise<{ code: number | null; text: string }> => {
    const bursts = typingBursts(text);
    const clock = options.now ?? Date.now;
    if (
      remainingTimeoutMs(deadlineAt, clock) <
      bursts.length * TYPING_STEP_COST_MS + AGENT_CURSOR_DWELL_HEADROOM_MS
    )
      return execute([...prefix, ...argv]);
    const steps = [
      ...(kind === 'fill' ? [[...prefix, 'fill', ref, '']] : []),
      [...prefix, 'focus', ref],
    ];
    for (const step of steps) {
      await refuseOffBoundTab(`browser_act ${kind}`);
      const prepared = await execute(step);
      if (prepared.code !== 0 && prepared.code !== null) return prepared;
    }
    for (const burst of bursts) {
      await refuseOffBoundTab(`browser_act ${kind}`);
      const typed = await execute([...prefix, 'keyboard', 'type', burst]);
      if (typed.code !== 0 && typed.code !== null) return typed;
      await sleep(TYPING_PAUSE_MS, undefined, { signal: options.signal }).catch(() => {});
    }
    return { code: 0, text: `${kind} ok` };
  };

  const pageValue = async (what: 'title' | 'url'): Promise<string | null> => {
    const answer = await read([...prefix, 'get', what]);
    if (answer.code !== 0) return null;
    return (
      answer.text
        .split('\n')
        .map((line) => line.trim())
        .filter(
          (line) => line !== '' && !line.startsWith('[agent-browser]') && !line.startsWith('⚠'),
        )
        .at(-1) ?? ''
    );
  };

  const browserWindow = async (): Promise<string | 'none' | null> => {
    const title = await pageValue('title');
    const url = await pageValue('url');
    const name =
      title !== null && title !== ''
        ? title
        : url === null || url === '' || url === 'about:blank'
          ? 'about:blank'
          : null;
    if (name === null) return null;
    const found = await read([
      'xdotool',
      'search',
      '--onlyvisible',
      '--name',
      `^${escapeRegExp(name)} - Chromium$`,
    ]);
    if (found.code === 1) return 'none';
    if (found.code !== 0) return null;
    const windows = found.text.split(/\s+/).filter((word) => /^\d+$/.test(word));
    return windows.length === 1 ? (windows[0] ?? null) : null;
  };

  const navigateByAddressBar = async (
    url: string,
  ): Promise<{ code: number | null; text: string } | null> => {
    let window = await browserWindow();
    if (window === 'none') {
      const blank = await execute([...prefix, 'open', 'about:blank']);
      if (blank.code !== 0 && blank.code !== null) return null;
      window = await browserWindow();
    }
    if (window === null || window === 'none') return null;
    const delay = Math.min(80, Math.max(15, Math.round(ADDRESS_BAR_TYPING_MS / url.length)));
    for (const step of [
      ['xdotool', 'windowactivate', '--sync', window, 'key', '--clearmodifiers', 'ctrl+l'],
      ['xdotool', 'type', '--delay', String(delay), url],
      ['xdotool', 'key', 'Return'],
    ]) {
      const done = await execute(step);
      if (done.code !== 0 && done.code !== null) return null;
    }
    await sleep(ADDRESS_BAR_SETTLE_MS, undefined, { signal: options.signal }).catch(() => {});
    await read([...prefix, 'wait', '--load', 'load']);
    const href = (await pageValue('url')) ?? '';
    if (href.startsWith('chrome-error://')) {
      refuse(`✗ Navigation failed: ${url} did not load`, started);
    }
    if (!sameSite(url, href)) return null;
    const title = (await pageValue('title')) ?? '';
    return { code: 0, text: `✓ ${title}\n  ${href}` };
  };

  const showAgentCursor = async (ref: string, kind: AgentCursorKind): Promise<void> => {
    await read([...prefix, 'scrollintoview', ref]);
    const box = await read([...prefix, '--json', 'get', 'box', ref]);
    if (box.code !== 0) return;
    let parsed: z.infer<typeof cursorBoxSchema>;
    try {
      parsed = cursorBoxSchema.parse(JSON.parse(box.text));
    } catch {
      return;
    }
    const { x, y, width, height } = parsed.data;
    const target = { x: x + width / 2, y: y + height / 2 };
    const drawn = await read([
      ...prefix,
      '--json',
      'eval',
      agentCursorScript(target.x, target.y, kind),
    ]);
    const clock = options.now ?? Date.now;
    if (
      drawn.code !== 0 ||
      remainingTimeoutMs(deadlineAt, clock) < AGENT_CURSOR_DWELL_MS + AGENT_CURSOR_DWELL_HEADROOM_MS
    )
      return;
    await sleep(AGENT_CURSOR_DWELL_MS, undefined, { signal: options.signal }).catch(() => {});
  };

  const withDetection = async (text: string): Promise<BrowserToolResult> => {
    const detection = await read([...prefix, '--json', 'eval', LOGIN_DETECTION_SCRIPT]);
    const signals = detection.code === 0 ? parseLoginSignals(detection.text) : null;
    if (signals === null) {
      return { text: `[login detection unavailable]\n${clearInputValues(text)}` };
    }
    if (signals.length === 0) return { text };
    return {
      text: `[login form: ${signals.join(', ')}]\n${clearInputValues(text)}`,
      loginForm: { signals },
    };
  };

  const cairnOrigins = options.cairnOrigins;
  const cairnPage = options.isCairnPage ?? isCairnPage;
  const currentUrl = async (): Promise<string | null> => {
    const answer = await read([...prefix, '--json', 'get', 'url']);
    if (answer.code !== 0) return null;
    try {
      const url = (
        JSON.parse(answer.text.trim().split('\n').at(-1) ?? '') as { data?: { url?: unknown } }
      ).data?.url;
      return typeof url === 'string' ? url : null;
    } catch {
      return null;
    }
  };
  const refuseOnCairn = async (what: string): Promise<void> => {
    if (cairnOrigins.length === 0) return;
    const url = await currentUrl();
    if (url === null)
      refuse(`${what} refused: the current page address could not be read`, started);
    if (await cairnPage(url, cairnOrigins))
      refuse(`${what} refused: ${url} ${CAIRN_PAGE_REFUSAL}`, started);
  };
  const blocks = cairnBlockPatterns(cairnOrigins);
  const blockCairn = async (what: string): Promise<void> => {
    if (blocks.length === 0) return;
    const blocked = await read([
      ...prefix,
      'batch',
      '--bail',
      ...blocks.flatMap((pattern) => [
        `network unroute ${pattern}`,
        `network route ${pattern} --abort`,
      ]),
    ]);
    if (blocked.code !== 0) {
      const cause = blocked.text.split('\n').at(-1)?.slice(0, 300) ?? '';
      refuse(
        `${what} refused: Cairn's addresses could not be blocked in the agent browser${cause === '' ? '' : `: ${cause}`}`,
        started,
      );
    }
  };
  const activeTab = async (): Promise<string | null> => {
    const answer = await read([...prefix, '--json', 'tab', 'list']);
    if (answer.code !== 0) return null;
    return parseTabList(answer.text)?.find((tab) => tab.active)?.targetId ?? null;
  };
  const selectScopeTab = async (tabScope: string): Promise<void> => {
    const label = scopeTabLabel(tabScope);
    const listed = await read([...prefix, '--json', 'tab', 'list']);
    const tabs = listed.code === 0 ? parseTabList(listed.text) : null;
    if (tabs === null) refuse(`${tool} refused: the browser tabs could not be listed`, started);
    const clock = options.now ?? Date.now;
    for (const tab of tabs) {
      if (tab.label === null || !tab.label.startsWith(CARD_TAB_PREFIX) || tab.label === label)
        continue;
      const key = scopeTabKey(session, tab.label);
      const lastUsed = scopeTabUse.get(key);
      if (lastUsed === undefined) scopeTabUse.set(key, clock());
      else if (clock() - lastUsed > CARD_TAB_IDLE_MS) {
        await read([...prefix, 'tab', 'close', tab.label]);
        scopeTabUse.delete(key);
      }
    }
    scopeTabUse.set(scopeTabKey(session, label), clock());
    const selected = await read(
      tabs.some((tab) => tab.label === label)
        ? [...prefix, 'tab', label]
        : [...prefix, 'tab', 'new', '--label', label],
    );
    if (selected.code !== 0 && selected.code !== null) {
      refuse(`${tool} refused: this task's browser tab could not be selected`, started);
    }
  };
  let validatedNavigateUrl: string | null = null;
  if (tool === 'browser_navigate') {
    const parsed = navigateParams.safeParse(params);
    if (!parsed.success) {
      refuse('browser_navigate needs a non-empty url string', started);
    }
    let address: URL | null = null;
    try {
      const raw = parsed.data.url.trim();
      const spaced = [...raw].some((char) => {
        const code = char.charCodeAt(0);
        return code <= 0x20 || code === 0x7f;
      });
      address = spaced ? null : new URL(raw);
    } catch {}
    if (address === null || (address.protocol !== 'http:' && address.protocol !== 'https:')) {
      refuse(
        'browser_navigate only accepts well-formed http(s) URLs without spaces or control characters',
        started,
      );
    }
    if (await cairnPage(address.href, cairnOrigins)) {
      refuse(`browser_navigate refused: ${address.href} ${CAIRN_PAGE_REFUSAL}`, started);
    }
    validatedNavigateUrl = address.href;
  }
  const parsedAct = tool === 'browser_act' ? actParams.safeParse(params) : null;
  if (parsedAct !== null && !parsedAct.success) {
    refuse('browser_act needs a non-empty actions list', started);
  }
  if (parsedAct?.success === true) {
    for (const action of parsedAct.data.actions) {
      if (action.kind === 'fill_secret') continue;
      try {
        actionArgv(action);
      } catch (error) {
        if (error instanceof ComputerRefusal) refuse(error.message, started);
        throw error;
      }
    }
  }
  if (options.tabScope !== undefined) await selectScopeTab(options.tabScope);
  await blockCairn(tool);
  const boundTab = cairnOrigins.length === 0 ? null : await activeTab();
  if (cairnOrigins.length > 0 && boundTab === null) {
    refuse(`${tool} refused: the active tab could not be read`, started);
  }
  const refuseOffBoundTab = async (what: string): Promise<void> => {
    if (cairnOrigins.length === 0) return;
    await blockCairn(what);
    if ((await activeTab()) !== boundTab) {
      refuse(
        `${what} refused: another tab became active during this call; call again to act on it`,
        started,
      );
    }
    await refuseOnCairn(what);
  };

  if (tool === 'browser_navigate') {
    const url = validatedNavigateUrl;
    if (url === null) throw new Error('browser_navigate URL was not validated');
    const result =
      (headless ? null : await navigateByAddressBar(url)) ??
      (await execute([...prefix, 'open', url]));
    if (result.code !== 0 && result.code !== null) {
      refuse(result.text || `agent-browser open failed with exit code ${result.code}`, started);
    }
    if (cairnOrigins.length > 0 && (await activeTab()) !== boundTab) {
      refuse(
        'browser_navigate refused: another tab became active while opening; call again to act on it',
        started,
      );
    }
    const landed = cairnOrigins.length === 0 ? url : await currentUrl();
    if (landed === null || (await cairnPage(landed, cairnOrigins))) {
      await execute([...prefix, 'open', 'about:blank']);
      refuse(
        landed === null
          ? 'browser_navigate refused: the page address could not be read after opening'
          : `browser_navigate refused: ${landed} ${CAIRN_PAGE_REFUSAL}`,
        started,
      );
    }
    if (!stealth && landed !== 'about:blank') {
      const probe = await read([...prefix, 'snapshot', '-i']);
      if (probe.code === 0 && isAutomationBlankSnapshot(probe.text))
        return { text: result.text || `opened ${url}`, automationBlocked: true };
    }
    return withDetection(result.text || `opened ${url}`);
  }

  if (tool === 'browser_snapshot') {
    await refuseOnCairn('browser_snapshot');
    const selector = typeof params.selector === 'string' ? params.selector.trim() : '';
    if (selector !== '') {
      const element = await execute([
        ...prefix,
        '--json',
        'get',
        'text',
        selector.startsWith('@') || /^e\d+$/.test(selector) ? normalizeRef(selector) : selector,
      ]);
      if (element.code !== 0 && element.code !== null) {
        refuse(
          element.text || `agent-browser get text failed with exit code ${element.code}`,
          started,
        );
      }
      await refuseOffBoundTab('browser_snapshot');
      return { text: elementTextSection(element.text) || '(element has no text)' };
    }
    const result = await execute([...prefix, 'snapshot', '-i']);
    if (result.code !== 0 && result.code !== null) {
      refuse(result.text || `agent-browser snapshot failed with exit code ${result.code}`, started);
    }
    await refuseOffBoundTab('browser_snapshot');
    const detected = await withDetection(result.text || '(empty snapshot)');
    const page = await read([...prefix, '--json', 'eval', PAGE_TEXT_SCRIPT]);
    return {
      ...detected,
      text: detected.text + (page.code === 0 ? pageTextSection(page.text) : ''),
    };
  }

  if (parsedAct === null || !parsedAct.success) throw new Error('browser_act was not validated');
  const lines: string[] = [];
  for (const action of parsedAct.data.actions) {
    await refuseOnCairn(`browser_act ${action.kind}`);
    if (action.ref !== undefined) {
      const snap = await read([...prefix, 'snapshot', '-i']);
      if (snap.code !== 0 && snap.code !== null) {
        refuse(snap.text || `agent-browser snapshot failed with exit code ${snap.code}`, started);
      }
      if (!refPresent(snap.text, action.ref)) {
        refuse(
          `ref ${normalizeRef(action.ref)} was not in a fresh snapshot; take browser_snapshot again`,
          started,
        );
      }
    }
    if (action.kind === 'fill_secret') {
      const credential = options.browserSecrets?.find(
        (saved) =>
          saved.name === action.secret &&
          saved.origin === normalizeBrowserSecretOrigin(action.origin),
      );
      if (credential === undefined)
        refuse('No saved browser password was authorized for this action.', started);
      try {
        await refuseOffBoundTab('browser_act fill_secret');
        const focused = await execute([...prefix, 'focus', normalizeRef(action.ref)]);
        if (focused.code !== 0) refuse('The password field could not be focused.', started);
        for (const fill of [false, true]) {
          const result = await collectExecute(
            provider,
            [...prefix, '--json', 'eval', '--stdin'],
            timed,
            started,
            browserSecretFillScript(
              credential.origin,
              fill ? credential.value : undefined,
              credential.username === undefined ? undefined : fill ? credential.username : null,
            ),
          );
          started = true;
          if (result.code !== 0 || JSON.parse(result.text).data?.result !== true)
            refuse(
              'The saved password was not filled: check the website and password field.',
              started,
            );
        }
      } catch {
        refuse(
          'Saved password fill could not be confirmed; take a fresh snapshot before continuing.',
          started,
        );
      }
      lines.push('Saved browser password filled.');
      continue;
    }
    if ((action.kind === 'fill' || action.kind === 'type') && action.ref !== undefined) {
      const ref = normalizeRef(action.ref);
      const type = await read([...prefix, 'get', 'attr', ref, 'type']);
      const autocomplete = await read([...prefix, 'get', 'attr', ref, 'autocomplete']);
      if (secretField(type.text, autocomplete.text)) {
        refuse(
          `browser_act ${action.kind} refused: ${ref} is a password or one-time code field; use fill_secret for a saved password, or request_takeover for verification`,
          started,
        );
      }
    }
    if (!stealth && !headless && action.ref !== undefined) {
      await showAgentCursor(normalizeRef(action.ref), action.kind === 'click' ? 'click' : 'point');
    }
    let argv: string[];
    try {
      argv = actionArgv(action);
    } catch (error) {
      if (error instanceof ComputerRefusal) refuse(error.message, started);
      throw error;
    }
    await refuseOffBoundTab(`browser_act ${action.kind}`);
    const result =
      (action.kind === 'fill' || action.kind === 'type') &&
      action.ref !== undefined &&
      action.text !== undefined
        ? await humanType(action.kind, normalizeRef(action.ref), action.text, argv)
        : await execute([...prefix, ...argv]);
    if (result.code !== 0 && result.code !== null) {
      refuse(
        result.text || `agent-browser ${action.kind} failed with exit code ${result.code}`,
        started,
      );
    }
    lines.push(result.text || `${action.kind} ok`);
  }
  return { text: lines.join('\n') };
}

export async function closeScopeTab(
  provider: ComputerProvider,
  options: BrowserRunOptions & { tabScope: string },
): Promise<string> {
  const label = scopeTabLabel(options.tabScope);
  const binary = options.binary ?? AGENT_BROWSER_BINARY;
  const deadlineAt = browserDeadlineAt(options);
  const timed = { ...options, deadlineAt };
  let closed = 0;
  for (const stealth of [false, true]) {
    const session = browserSessionFor(options, stealth);
    const key = scopeTabKey(session, label);
    if (!scopeTabUse.has(key)) continue;
    scopeTabUse.delete(key);
    const prefix = [binary, ...sessionFlag(session)];
    const listed = await collectExecute(
      provider,
      [...prefix, '--json', 'tab', 'list'],
      timed,
      false,
    );
    const tab =
      listed.code === 0 ? parseTabList(listed.text)?.find((t) => t.label === label) : null;
    if (tab === null || tab === undefined) continue;
    const done = await collectExecute(provider, [...prefix, 'tab', 'close', label], timed, false);
    if (done.code !== 0 && done.code !== null) refuse(`closing tab ${label} failed`, true);
    closed += 1;
    if (tab.active) {
      const back = await collectExecute(
        provider,
        [...prefix, '--json', 'tab', 'list'],
        timed,
        false,
      );
      if (parseTabList(back.text)?.some((t) => t.label === COORDINATOR_TAB_LABEL))
        await collectExecute(provider, [...prefix, 'tab', COORDINATOR_TAB_LABEL], timed, false);
    }
  }
  return closed === 0 ? 'no tab to close' : `closed ${closed} tab`;
}
