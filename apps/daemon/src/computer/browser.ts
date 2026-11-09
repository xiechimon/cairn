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

export interface BrowserRunOptions {
  timeoutMs: number;
  signal: AbortSignal;
  session?: string;
  binary?: string;
  env?: Readonly<Record<string, string>>;
}

function sessionFlag(session: string): string[] {
  return ['--session', session];
}

function headedFlags(): string[] {
  return ['--headed'];
}

async function collectExecute(
  provider: ComputerProvider,
  argv: readonly string[],
  options: BrowserRunOptions,
): Promise<{ text: string; code: number | null }> {
  const events = await provider.execute({
    argv: [...argv],
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    ...(options.env ? { env: options.env } : {}),
  });
  let text = '';
  let code: number | null = null;
  for await (const event of events as AsyncIterable<ComputerProcessEvent>) {
    if (event.kind === 'stdout' || event.kind === 'stderr') text += event.text;
    else if (event.kind === 'exit') code = event.code;
  }
  return { text: text.trim(), code };
}

function normalizeRef(ref: string): string {
  return ref.startsWith('@') ? ref : `@${ref}`;
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
      return [action.kind, ref, '--', action.text];
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
  const needle = normalizeRef(ref);
  return snapshot.includes(needle);
}

export async function runBrowserTool(
  provider: ComputerProvider,
  tool: BrowserToolName,
  params: Record<string, unknown>,
  options: BrowserRunOptions,
): Promise<string> {
  const binary = options.binary ?? AGENT_BROWSER_BINARY;
  const session = options.session ?? AGENT_BROWSER_SESSION;
  const prefix = [binary, ...sessionFlag(session), ...headedFlags()];

  if (tool === 'browser_navigate') {
    const parsed = navigateParams.safeParse(params);
    if (!parsed.success) {
      throw new ComputerRefusal('browser_navigate needs a non-empty url string');
    }
    const url = parsed.data.url;
    if (!/^https?:\/\//i.test(url)) {
      throw new ComputerRefusal('browser_navigate only accepts http(s) URLs');
    }
    const result = await collectExecute(provider, [...prefix, 'open', url], options);
    if (result.code !== 0 && result.code !== null) {
      throw new ComputerRefusal(
        result.text || `agent-browser open failed with exit code ${result.code}`,
      );
    }
    return result.text || `opened ${url}`;
  }

  if (tool === 'browser_snapshot') {
    const result = await collectExecute(provider, [...prefix, 'snapshot', '-i'], options);
    if (result.code !== 0 && result.code !== null && result.text === '') {
      throw new ComputerRefusal(`agent-browser snapshot failed with exit code ${result.code}`);
    }
    return result.text || '(empty snapshot)';
  }

  const parsed = actParams.safeParse(params);
  if (!parsed.success) {
    throw new ComputerRefusal('browser_act needs a non-empty actions list');
  }
  const lines: string[] = [];
  for (const action of parsed.data.actions) {
    if (action.ref !== undefined) {
      const snap = await collectExecute(provider, [...prefix, 'snapshot', '-i'], options);
      if (!refPresent(snap.text, action.ref)) {
        throw new ComputerRefusal(
          `ref ${normalizeRef(action.ref)} was not in a fresh snapshot; take browser_snapshot again`,
        );
      }
    }
    const argv = [...prefix, ...actionArgv(action)];
    const result = await collectExecute(provider, argv, options);
    if (result.code !== 0 && result.code !== null) {
      throw new ComputerRefusal(
        result.text || `agent-browser ${action.kind} failed with exit code ${result.code}`,
      );
    }
    lines.push(result.text || `${action.kind} ok`);
  }
  return lines.join('\n');
}
