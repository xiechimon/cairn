import { LOGIN_SIGNALS, type LoginForm, type LoginSignal } from '@cairn/shared';
import { z } from 'zod';
import type { ComputerProcessEvent, ComputerProvider } from './provider.js';
import { ComputerRefusal } from './provider.js';

export const AGENT_BROWSER_BINARY = 'agent-browser';
export const AGENT_BROWSER_SESSION = 'cairn';

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
  actions: z.array(actActionSchema).min(1).max(32),
});

export type BrowserToolName = 'browser_navigate' | 'browser_snapshot' | 'browser_act';

export interface BrowserToolResult {
  text: string;
  loginForm?: LoginForm;
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

export function agentCursorScript(x: number, y: number, kind: AgentCursorKind): string {
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw new Error('cursor needs finite coordinates');
  const left = Math.round(x);
  const top = Math.round(y);
  return `(() => {
  const ns = 'http://www.w3.org/2000/svg';
  const host = document.body || document.documentElement;
  let cursor = document.getElementById('__cairnAgentCursor');
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.id = '__cairnAgentCursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.cssText = 'all:initial;position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:flex;align-items:flex-start;gap:2px;transition:transform 420ms cubic-bezier(.2,.8,.2,1),opacity 240ms ease;will-change:transform;';
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
    cursor.style.transform = 'translate(${left - 3}px, ${top - 2}px)';
    host.appendChild(cursor);
  }
  cursor.style.opacity = '1';
  cursor.style.transform = 'translate(${left - 3}px, ${top - 2}px)';
  if (${JSON.stringify(kind)} === 'click') {
    const ring = document.createElement('div');
    ring.setAttribute('aria-hidden', 'true');
    ring.style.cssText = 'all:initial;position:fixed;left:${left - 14}px;top:${top - 14}px;width:28px;height:28px;border-radius:50%;border:2px solid #d97757;z-index:2147483646;pointer-events:none;opacity:0;';
    host.appendChild(ring);
    ring.animate([{ transform: 'scale(.4)', opacity: 1 }, { transform: 'scale(1.7)', opacity: 0 }], { duration: 650, delay: 380, easing: 'ease-out' });
    setTimeout(() => ring.remove(), 1200);
  }
  clearTimeout(window.__cairnAgentCursorTimer);
  window.__cairnAgentCursorTimer = setTimeout(() => { cursor.style.opacity = '0'; }, 6000);
  return true;
})()`;
}

const cursorBoxSchema = z.object({
  data: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
});

const SECRET_AUTOCOMPLETE = new Set(['current-password', 'new-password', 'one-time-code']);

function secretField(type: string, autocomplete: string): boolean {
  if (type.trim().toLowerCase() === 'password') return true;
  return autocomplete
    .toLowerCase()
    .split(/\s+/)
    .some((token) => SECRET_AUTOCOMPLETE.has(token));
}

const INPUT_VALUE_LINE =
  /^(\s*- (?:textbox|searchbox|combobox|spinbutton|slider)\b(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]*\])?(?: [a-z-]+ \[[^\]]*\])?): .*$/;

function clearInputValues(snapshot: string): string {
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
  binary?: string;
  deadlineAt?: number;
  timeoutMs?: number;
  now?: () => number;
}

export function browserSessionName(scopeKey: string | undefined): string {
  if (scopeKey === undefined || scopeKey.length === 0) return AGENT_BROWSER_SESSION;
  const cleaned = scopeKey.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 64) : AGENT_BROWSER_SESSION;
}

function sessionFlag(session: string): string[] {
  return ['--session', session, '--restore'];
}

function headedFlags(): string[] {
  return ['--headed'];
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
  return snapshot.includes(`[ref=${bareRef(ref)}]`);
}

function refuse(message: string, started: boolean): never {
  throw new ComputerRefusal(message, started ? 'unknown' : 'not_delivered');
}

export async function runBrowserTool(
  provider: ComputerProvider,
  tool: BrowserToolName,
  params: Record<string, unknown>,
  options: BrowserRunOptions,
): Promise<BrowserToolResult> {
  const binary = options.binary ?? AGENT_BROWSER_BINARY;
  const session = browserSessionName(options.session);
  const prefix = [binary, ...sessionFlag(session), ...headedFlags()];
  const deadlineAt = browserDeadlineAt(options);
  const timed = { ...options, deadlineAt };
  let started = false;

  const execute = async (argv: readonly string[]) => {
    const result = await collectExecute(provider, argv, timed, started);
    started = true;
    return result;
  };
  const read = (argv: readonly string[]) => collectExecute(provider, argv, timed, started);

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
    await read([
      ...prefix,
      '--json',
      'eval',
      agentCursorScript(x + width / 2, y + height / 2, kind),
    ]);
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

  if (tool === 'browser_navigate') {
    const parsed = navigateParams.safeParse(params);
    if (!parsed.success) {
      refuse('browser_navigate needs a non-empty url string', started);
    }
    const url = parsed.data.url;
    if (!/^https?:\/\//i.test(url)) {
      refuse('browser_navigate only accepts http(s) URLs', started);
    }
    const result = await execute([...prefix, 'open', url]);
    if (result.code !== 0 && result.code !== null) {
      refuse(result.text || `agent-browser open failed with exit code ${result.code}`, started);
    }
    return withDetection(result.text || `opened ${url}`);
  }

  if (tool === 'browser_snapshot') {
    const result = await execute([...prefix, 'snapshot', '-i']);
    if (result.code !== 0 && result.code !== null) {
      refuse(result.text || `agent-browser snapshot failed with exit code ${result.code}`, started);
    }
    return withDetection(result.text || '(empty snapshot)');
  }

  const parsed = actParams.safeParse(params);
  if (!parsed.success) {
    refuse('browser_act needs a non-empty actions list', started);
  }
  const lines: string[] = [];
  for (const action of parsed.data.actions) {
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
    if ((action.kind === 'fill' || action.kind === 'type') && action.ref !== undefined) {
      const ref = normalizeRef(action.ref);
      const type = await read([...prefix, 'get', 'attr', ref, 'type']);
      const autocomplete = await read([...prefix, 'get', 'attr', ref, 'autocomplete']);
      if (secretField(type.text, autocomplete.text)) {
        refuse(
          `browser_act ${action.kind} refused: ${ref} is a password or one-time code field; ask the owner with request_takeover`,
          started,
        );
      }
    }
    if (action.ref !== undefined) {
      await showAgentCursor(normalizeRef(action.ref), action.kind === 'click' ? 'click' : 'point');
    }
    let argv: string[];
    try {
      argv = actionArgv(action);
    } catch (error) {
      if (error instanceof ComputerRefusal) refuse(error.message, started);
      throw error;
    }
    const result = await execute([...prefix, ...argv]);
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
