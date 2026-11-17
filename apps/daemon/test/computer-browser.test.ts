import { createContext, runInContext } from 'node:vm';
import { describe, expect, test } from 'vitest';
import {
  AGENT_CURSOR_INIT_PATH,
  AGENT_CURSOR_INIT_SCRIPT,
  agentCursorScript,
  browserSessionName,
  isStealthBrowserCommand,
  LOGIN_DETECTION_SCRIPT,
  runBrowserTool,
} from '../src/computer/browser.js';
import { isCairnPage } from '../src/computer/host-screen-self.js';
import type { ComputerProvider, ComputerRefusal } from '../src/computer/provider.js';

function recordingProvider(log: string[], snapshot = '- button "Go" [ref=e1]\n'): ComputerProvider {
  return {
    async execute(request) {
      log.push(request.argv.join(' '));
      expect(request.env).toBeUndefined();
      return (async function* () {
        if (request.argv.includes('snapshot')) {
          yield { kind: 'stdout' as const, text: snapshot };
        } else {
          yield { kind: 'stdout' as const, text: 'ok\n' };
        }
        yield { kind: 'exit' as const, code: 0 };
      })();
    },
    async listFiles() {
      return [];
    },
    async readFile() {
      return '';
    },
    async writeFile() {},
    async killAll() {},
  };
}

describe('browserSessionName', () => {
  test('maps chief scope keys to valid agent-browser session names', () => {
    expect(browserSessionName('chief:c1')).toBe('chief_c1');
    expect(browserSessionName(undefined)).toBe('cairn');
    expect(browserSessionName('chief:c1', true)).toBe('chief_c1-stealth');
  });

  test('only a session ending in the stealth suffix is a stealth command', () => {
    expect(
      isStealthBrowserCommand(['agent-browser', '--session', 'chief_c1-stealth', 'open']),
    ).toBe(true);
    expect(isStealthBrowserCommand(['agent-browser', '--session', 'chief_c1', 'open'])).toBe(false);
    expect(isStealthBrowserCommand(['bash', '--session', 'x-stealth'])).toBe(false);
  });
});

describe('runBrowserTool', () => {
  test('stealth: true drives the separate stealth session', async () => {
    const log: string[] = [];
    await runBrowserTool(
      recordingProvider(log),
      'browser_snapshot',
      { stealth: true },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
        cairnOrigins: [],
        session: 'chief:1',
      },
    );
    expect(log.some((line) => line.startsWith('agent-browser --session chief_1-stealth '))).toBe(
      true,
    );
    expect(log.some((line) => line.startsWith('agent-browser --session chief_1 '))).toBe(false);
  });

  test('navigates with headed agent-browser open', async () => {
    const log: string[] = [];
    const { text } = await runBrowserTool(
      recordingProvider(log),
      'browser_navigate',
      { url: 'https://example.com' },
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
        cairnOrigins: [],
        session: 'chief:1',
      },
    );
    expect(text).toContain('ok');
    expect(
      log.filter((line) => !line.startsWith('xdotool ') && !/ get (title|url)$/.test(line))[0],
    ).toContain(
      'agent-browser --session chief_1 --headed --init-script .cairn/agent-cursor.js open https://example.com',
    );
  });

  test('refuses non-http URLs before delivery', async () => {
    await expect(
      runBrowserTool(
        recordingProvider([]),
        'browser_navigate',
        { url: 'file:///etc/passwd' },
        { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [] },
      ),
    ).rejects.toMatchObject({ delivery: 'not_delivered' });
  });

  test('rechecks refs before acting using [ref=eN] snapshot tokens', async () => {
    const log: string[] = [];
    await runBrowserTool(
      recordingProvider(log),
      'browser_act',
      { actions: [{ kind: 'click', ref: 'e1' }] },
      { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [], session: 's' },
    );
    expect(log.filter((line) => !line.endsWith(' get url'))[0]).toContain('snapshot -i');
    expect(log.at(-1)).toContain('click @e1');
  });

  test('fill and type pass text without a literal -- separator', async () => {
    const log: string[] = [];
    await runBrowserTool(
      recordingProvider(log),
      'browser_act',
      { actions: [{ kind: 'fill', ref: '@e1', text: 'hello' }] },
      { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [], session: 's' },
    );
    expect(log.some((line) => line.includes(' -- '))).toBe(false);
    const typed = log
      .filter((line) => line.includes(' keyboard type '))
      .map((line) => line.slice(line.indexOf(' keyboard type ') + ' keyboard type '.length));
    expect(typed.join('')).toBe('hello');
  });

  test('refuses when the ref is missing from a fresh snapshot', async () => {
    const provider: ComputerProvider = {
      async execute() {
        return (async function* () {
          yield { kind: 'stdout' as const, text: '- button "Other" [ref=e9]\n' };
          yield { kind: 'exit' as const, code: 0 };
        })();
      },
      async listFiles() {
        return [];
      },
      async readFile() {
        return '';
      },
      async writeFile() {},
      async killAll() {},
    };
    await expect(
      runBrowserTool(
        provider,
        'browser_act',
        { actions: [{ kind: 'click', ref: '@e1' }] },
        { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [] },
      ),
    ).rejects.toThrow(/not in a fresh snapshot/);
  });

  test('finds refs that follow other attributes, and does not mistake e70 for e7', async () => {
    const snapshot = '- heading "BOSS直聘" [level=3, ref=e70]\n';
    const log: string[] = [];
    await runBrowserTool(
      recordingProvider(log, snapshot),
      'browser_act',
      { actions: [{ kind: 'click', ref: '@e70' }] },
      { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [], session: 's' },
    );
    expect(log.at(-1)).toContain('click @e70');
    await expect(
      runBrowserTool(
        recordingProvider([], snapshot),
        'browser_act',
        { actions: [{ kind: 'click', ref: '@e7' }] },
        { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [], session: 's' },
      ),
    ).rejects.toThrow(/not in a fresh snapshot/);
  });

  test('treats nonzero snapshot exits as failures even when stderr has text', async () => {
    const provider: ComputerProvider = {
      async execute(request) {
        return (async function* () {
          if (request.argv.at(-1) === 'url') {
            yield { kind: 'stdout' as const, text: 'https://example.com/\n' };
            yield { kind: 'exit' as const, code: 0 };
            return;
          }
          yield { kind: 'stderr' as const, text: 'browser crashed\n' };
          yield { kind: 'exit' as const, code: 1 };
        })();
      },
      async listFiles() {
        return [];
      },
      async readFile() {
        return '';
      },
      async writeFile() {},
      async killAll() {},
    };
    await expect(
      runBrowserTool(
        provider,
        'browser_snapshot',
        {},
        { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [] },
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/browser crashed|exit code 1/),
      delivery: 'unknown',
    });
  });

  test('marks mid-batch failures as unknown delivery', async () => {
    const provider: ComputerProvider = {
      async execute(request) {
        return (async function* () {
          if (request.argv.includes('snapshot')) {
            yield { kind: 'stdout' as const, text: '- button "Go" [ref=e1]\n' };
            yield { kind: 'exit' as const, code: 0 };
            return;
          }
          if (request.argv.includes('click') || request.argv.at(-1) === 'url') {
            yield { kind: 'stdout' as const, text: 'clicked\n' };
            yield { kind: 'exit' as const, code: 0 };
            return;
          }
          yield { kind: 'stderr' as const, text: 'fill failed\n' };
          yield { kind: 'exit' as const, code: 2 };
        })();
      },
      async listFiles() {
        return [];
      },
      async readFile() {
        return '';
      },
      async writeFile() {},
      async killAll() {},
    };
    await expect(
      runBrowserTool(
        provider,
        'browser_act',
        {
          actions: [
            { kind: 'click', ref: 'e1' },
            { kind: 'fill', ref: 'e1', text: 'x' },
          ],
        },
        { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [] },
      ),
    ).rejects.toMatchObject({ delivery: 'unknown' } satisfies Partial<ComputerRefusal>);
  });

  test('recomputes remaining time from one absolute deadline across the batch', async () => {
    let clock = 1_000;
    const timeouts: number[] = [];
    const provider: ComputerProvider = {
      async execute(request) {
        timeouts.push(request.timeoutMs);
        clock += 400;
        return (async function* () {
          if (request.argv.includes('snapshot')) {
            yield { kind: 'stdout' as const, text: '- button "Go" [ref=e1]\n' };
          } else {
            yield { kind: 'stdout' as const, text: 'ok\n' };
          }
          yield { kind: 'exit' as const, code: 0 };
        })();
      },
      async listFiles() {
        return [];
      },
      async readFile() {
        return '';
      },
      async writeFile() {},
      async killAll() {},
    };
    await runBrowserTool(
      provider,
      'browser_act',
      {
        actions: [
          { kind: 'click', ref: 'e1' },
          { kind: 'click', ref: 'e1' },
        ],
      },
      {
        deadlineAt: 5_000,
        now: () => clock,
        signal: new AbortController().signal,
        cairnOrigins: [],
      },
    );
    expect(timeouts).toEqual([4_000, 3_600, 3_200, 2_800, 2_400, 2_000, 1_600, 1_200]);
  });

  test('aborts later batch actions once the shared deadline elapses', async () => {
    let clock = 1_000;
    let starts = 0;
    const provider: ComputerProvider = {
      async execute(request) {
        starts += 1;
        clock += 600;
        return (async function* () {
          if (request.argv.includes('snapshot')) {
            yield { kind: 'stdout' as const, text: '- button "Go" [ref=e1]\n' };
          } else {
            yield { kind: 'stdout' as const, text: 'ok\n' };
          }
          yield { kind: 'exit' as const, code: 0 };
        })();
      },
      async listFiles() {
        return [];
      },
      async readFile() {
        return '';
      },
      async writeFile() {},
      async killAll() {},
    };
    await expect(
      runBrowserTool(
        provider,
        'browser_act',
        {
          actions: [
            { kind: 'click', ref: 'e1' },
            { kind: 'click', ref: 'e1' },
          ],
        },
        {
          deadlineAt: 4_000,
          now: () => clock,
          signal: new AbortController().signal,
          cairnOrigins: [],
        },
      ),
    ).rejects.toMatchObject({
      message: 'browser call deadline elapsed',
      delivery: 'unknown',
    } satisfies Partial<ComputerRefusal>);
    expect(starts).toBe(5);
  });
});

function detectingProvider(
  log: string[],
  evalOutput: { text: string; code: number },
  snapshot = '- textbox "Password" [ref=e2]\n',
): ComputerProvider {
  return {
    async execute(request) {
      log.push(request.argv.join(' '));
      return (async function* () {
        if (request.argv.includes('eval')) {
          yield { kind: 'stdout' as const, text: evalOutput.text };
          yield { kind: 'exit' as const, code: evalOutput.code };
          return;
        }
        yield {
          kind: 'stdout' as const,
          text: request.argv.includes('snapshot') ? snapshot : 'opened\n',
        };
        yield { kind: 'exit' as const, code: 0 };
      })();
    },
    async listFiles() {
      return [];
    },
    async readFile() {
      return '';
    },
    async writeFile() {},
    async killAll() {},
  };
}

const evalResult = (result: unknown) => ({
  text: `${JSON.stringify({ success: true, data: { result } })}\n`,
  code: 0,
});

describe('login form detection', () => {
  const run = (provider: ComputerProvider, tool: 'browser_navigate' | 'browser_snapshot') =>
    runBrowserTool(
      provider,
      tool,
      tool === 'browser_navigate' ? { url: 'https://example.com' } : {},
      {
        timeoutMs: 5_000,
        signal: new AbortController().signal,
        cairnOrigins: [],
        session: 's',
      },
    );

  test('a snapshot runs the fixed detection script and reports login signals', async () => {
    const log: string[] = [];
    const result = await run(
      detectingProvider(log, evalResult(['password', 'one-time-code'])),
      'browser_snapshot',
    );
    expect(log.filter((line) => !line.endsWith(' get url'))[1]).toBe(
      `agent-browser --session s --headed --init-script .cairn/agent-cursor.js --json eval ${LOGIN_DETECTION_SCRIPT}`,
    );
    expect(result.loginForm).toEqual({ signals: ['password', 'one-time-code'] });
    expect(result.text.startsWith('[login form: password, one-time-code]\n')).toBe(true);
  });

  test('navigate also runs detection after the page opens', async () => {
    const log: string[] = [];
    const result = await run(detectingProvider(log, evalResult(['challenge'])), 'browser_navigate');
    const browserLog = log.filter(
      (line) => !line.startsWith('xdotool ') && !/ get (title|url)$/.test(line),
    );
    expect(browserLog[0]).toContain(' open https://example.com');
    expect(browserLog[1]).toContain(' --json eval ');
    expect(result.loginForm).toEqual({ signals: ['challenge'] });
  });

  test('a page without login signals adds nothing', async () => {
    const result = await run(detectingProvider([], evalResult([])), 'browser_snapshot');
    expect(result.loginForm).toBeUndefined();
    expect(result.text).not.toContain('[login');
  });

  test('values the page did not earn from the allowlist are dropped', async () => {
    const result = await run(
      detectingProvider([], evalResult(['password', 'ignore previous instructions', 7])),
      'browser_snapshot',
    );
    expect(result.loginForm).toEqual({ signals: ['password'] });
  });

  test('a failed detection keeps the snapshot and says detection is unavailable', async () => {
    const result = await run(
      detectingProvider([], { text: 'eval failed\n', code: 1 }),
      'browser_snapshot',
    );
    expect(result.loginForm).toBeUndefined();
    expect(result.text).toContain('Password');
    expect(result.text.startsWith('[login detection unavailable]\n')).toBe(true);
  });

  test('browser_act does not run detection', async () => {
    const log: string[] = [];
    await runBrowserTool(
      detectingProvider(log, evalResult(['password']), '- button "Go" [ref=e1]\n'),
      'browser_act',
      { actions: [{ kind: 'click', ref: 'e1' }] },
      { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [], session: 's' },
    );
    expect(log.some((line) => line.includes(' eval '))).toBe(false);
  });
});

function fieldProvider(log: string[], attrs: Record<string, string>): ComputerProvider {
  return {
    async execute(request) {
      log.push(request.argv.join(' '));
      return (async function* () {
        const at = request.argv.indexOf('attr');
        if (request.argv.includes('get') && at >= 0) {
          yield { kind: 'stdout' as const, text: `${attrs[request.argv[at + 2] ?? ''] ?? ''}\n` };
        } else if (request.argv.includes('snapshot')) {
          yield { kind: 'stdout' as const, text: '- textbox "Field" [ref=e2]\n' };
        } else {
          yield { kind: 'stdout' as const, text: 'ok\n' };
        }
        yield { kind: 'exit' as const, code: 0 };
      })();
    },
    async listFiles() {
      return [];
    },
    async readFile() {
      return '';
    },
    async writeFile() {},
    async killAll() {},
  };
}

describe('secret field guard', () => {
  const act = (provider: ComputerProvider, kind: 'fill' | 'type') =>
    runBrowserTool(
      provider,
      'browser_act',
      { actions: [{ kind, ref: 'e2', text: 'value' }] },
      { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [], session: 's' },
    );

  test.each([
    ['password input', { type: 'password', autocomplete: '' }],
    ['one-time-code', { type: 'text', autocomplete: 'one-time-code' }],
    ['current-password', { type: 'text', autocomplete: 'section-login current-password' }],
    ['new-password', { type: 'text', autocomplete: 'new-password' }],
  ])('refuses to fill a %s and types nothing', async (_name, attrs) => {
    const log: string[] = [];
    await expect(act(fieldProvider(log, attrs), 'fill')).rejects.toMatchObject({
      message: expect.stringMatching(/password or one-time code/),
      delivery: 'not_delivered',
    });
    expect(log.some((line) => line.includes(' fill '))).toBe(false);
  });

  test('type into a password input is refused too', async () => {
    const log: string[] = [];
    await expect(
      act(fieldProvider(log, { type: 'password', autocomplete: '' }), 'type'),
    ).rejects.toMatchObject({ delivery: 'not_delivered' });
    expect(log.some((line) => / type @e2 /.test(line))).toBe(false);
  });

  test('a phone or username field is filled after the check', async () => {
    const log: string[] = [];
    await act(fieldProvider(log, { type: 'tel', autocomplete: 'tel' }), 'fill');
    expect(log).toContain(
      'agent-browser --session s --headed --init-script .cairn/agent-cursor.js get attr @e2 type',
    );
    expect(log).toContain(
      'agent-browser --session s --headed --init-script .cairn/agent-cursor.js get attr @e2 autocomplete',
    );
    expect(log).toContain(
      'agent-browser --session s --headed --init-script .cairn/agent-cursor.js focus @e2',
    );
    const typed = log
      .filter((line) => line.includes(' keyboard type '))
      .map((line) => line.slice(line.indexOf(' keyboard type ') + ' keyboard type '.length));
    expect(typed.join('')).toBe('value');
  });
});

describe('login form snapshot values', () => {
  const filled = [
    '- heading "Sign in" [level=1, ref=e1]',
    '- textbox "Phone" [ref=e2]: 13800000000',
    '- textbox "Code" [required, ref=e3]: 482913',
    '- textbox "Email": owner@example.com',
    '- combobox "Country" [expanded=false, ref=e4]: +86',
    '- searchbox "Find" [ref=e5]: secret query',
    '- spinbutton "Age" [ref=e6]: 33',
    '- checkbox "Remember me" [checked=true, ref=e7]',
    '- link "Forgot: password" [ref=e8]',
    '- button "Send code" [ref=e9]',
  ].join('\n');

  const snapshotOn = (signals: string[]) =>
    runBrowserTool(
      detectingProvider([], evalResult(signals), `${filled}\n`),
      'browser_snapshot',
      {},
      { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [], session: 's' },
    );

  test('every input value on a login page is cleared before the text leaves the daemon', async () => {
    const { text } = await snapshotOn(['one-time-code']);
    for (const value of [
      '13800000000',
      '482913',
      'owner@example.com',
      '+86',
      'secret query',
      '33',
    ]) {
      expect(text).not.toContain(value);
    }
    expect(text).toContain('- textbox "Phone" [ref=e2]: [value cleared]');
    expect(text).toContain('- textbox "Email": [value cleared]');
    expect(text).toContain('- checkbox "Remember me" [checked=true, ref=e7]');
    expect(text).toContain('- link "Forgot: password" [ref=e8]');
    expect(text).toContain('- button "Send code" [ref=e9]');
  });

  test('a page without login signals keeps its input values', async () => {
    const { text } = await snapshotOn([]);
    expect(text).toContain('- searchbox "Find" [ref=e5]: secret query');
  });

  test('a failed detection clears values too, because the page might be a login', async () => {
    const { text } = await runBrowserTool(
      detectingProvider([], { text: 'eval failed\n', code: 1 }, `${filled}\n`),
      'browser_snapshot',
      {},
      { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [], session: 's' },
    );
    expect(text).not.toContain('13800000000');
  });
});

function cursorProvider(
  log: string[],
  options: { box?: { text: string; code: number }; evalCode?: number } = {},
): ComputerProvider {
  return {
    async execute(request) {
      const line = request.argv.join(' ');
      log.push(line);
      return (async function* () {
        if (line.includes(' get box ')) {
          const box = options.box ?? {
            text: JSON.stringify({
              success: true,
              data: { x: 100, y: 200, width: 40, height: 20 },
            }),
            code: 0,
          };
          yield { kind: 'stdout' as const, text: box.text };
          yield { kind: 'exit' as const, code: box.code };
          return;
        }
        if (line.includes(' eval ')) {
          yield { kind: 'stdout' as const, text: '{"success":true,"data":{"result":true}}' };
          yield { kind: 'exit' as const, code: options.evalCode ?? 0 };
          return;
        }
        yield {
          kind: 'stdout' as const,
          text: request.argv.includes('snapshot') ? '- button "Go" [ref=e1]\n' : 'ok\n',
        };
        yield { kind: 'exit' as const, code: 0 };
      })();
    },
    async listFiles() {
      return [];
    },
    async readFile() {
      return '';
    },
    async writeFile() {},
    async killAll() {},
  };
}

interface FakeElement {
  id: string;
  style: Record<string, string>;
  offsetWidth: number;
  setAttribute(name: string, value: string): void;
  appendChild(child: FakeElement): FakeElement;
  append(...children: FakeElement[]): void;
  animate(): void;
  remove(): void;
}

function fakePage(options: { readyState: string; saved?: string; frame?: boolean }) {
  const byId = new Map<string, FakeElement>();
  const transforms: string[] = [];
  const storage = new Map<string, string>(
    options.saved === undefined ? [] : [['__cairnAgentCursor', options.saved]],
  );
  let parsed: (() => void) | undefined;
  const element = (): FakeElement => {
    const style: Record<string, string> = {};
    const node: FakeElement = {
      id: '',
      style: new Proxy(style, {
        set(target, key, value) {
          if (key === 'transform') transforms.push(String(value));
          target[String(key)] = String(value);
          return true;
        },
      }),
      offsetWidth: 0,
      setAttribute() {},
      appendChild(child) {
        if (child.id !== '') byId.set(child.id, child);
        return child;
      },
      append() {},
      animate() {},
      remove() {},
    };
    return node;
  };
  const body = element();
  const sandbox: Record<string, unknown> = {
    innerWidth: 1000,
    innerHeight: 600,
    setTimeout: () => 0,
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    document: {
      readyState: options.readyState,
      body,
      documentElement: body,
      getElementById: (id: string) => byId.get(id) ?? null,
      createElement: element,
      createElementNS: element,
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'DOMContentLoaded') parsed = listener;
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.top = options.frame ? {} : sandbox;
  const context = createContext(sandbox);
  return {
    run: (script: string) => runInContext(script, context),
    parsed: () => parsed?.(),
    transforms: () => transforms,
    cursors: () => (byId.has('__cairnAgentCursor') ? 1 : 0),
    stored: () => storage.get('__cairnAgentCursor'),
  };
}

describe('agent cursor on the live screen', () => {
  const click = (provider: ComputerProvider) =>
    runBrowserTool(
      provider,
      'browser_act',
      { actions: [{ kind: 'click', ref: 'e1' }] },
      { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [], session: 's' },
    );

  test('a click first moves the Coordinator cursor to the centre of its target', async () => {
    const log: string[] = [];
    await click(cursorProvider(log));
    const scroll = log.findIndex((line) => line.endsWith(' scrollintoview @e1'));
    const box = log.findIndex((line) => line.endsWith('--json get box @e1'));
    expect(scroll).toBeGreaterThan(-1);
    expect(box).toBeGreaterThan(scroll);
    const draw = log.findIndex(
      (line) => line.includes('--json eval') && line.includes('__cairnAgentCursor'),
    );
    const act = log.findIndex((line) => line.endsWith(' click @e1'));
    expect(box).toBeGreaterThan(-1);
    expect(draw).toBeGreaterThan(box);
    expect(act).toBeGreaterThan(draw);
    expect(log[draw]).toBe(
      `agent-browser --session s --headed --init-script .cairn/agent-cursor.js --json eval ${agentCursorScript(120, 210, 'click')}`,
    );
  });

  test('the cursor rests on its target before the click so the owner can see it', async () => {
    const log: string[] = [];
    const at: number[] = [];
    const provider = cursorProvider(log);
    const timed: ComputerProvider = {
      ...provider,
      async execute(request) {
        at.push(Date.now());
        return provider.execute(request);
      },
    };
    await click(timed);
    const draw = log.findIndex((line) => line.includes('__cairnAgentCursor'));
    const act = log.findIndex((line) => line.endsWith(' click @e1'));
    expect((at[act] ?? 0) - (at[draw] ?? 0)).toBeGreaterThanOrEqual(600);
  });

  test('without a drawn cursor the click does not wait', async () => {
    const log: string[] = [];
    const at: number[] = [];
    const provider = cursorProvider(log, { box: { text: 'not found', code: 1 } });
    const timed: ComputerProvider = {
      ...provider,
      async execute(request) {
        at.push(Date.now());
        return provider.execute(request);
      },
    };
    await click(timed);
    const box = log.findIndex((line) => line.endsWith('--json get box @e1'));
    const act = log.findIndex((line) => line.endsWith(' click @e1'));
    expect((at[act] ?? 0) - (at[box] ?? 0)).toBeLessThan(300);
  });

  test('the cursor stays on screen instead of fading out after a few seconds', () => {
    expect(agentCursorScript(120, 210, 'click')).not.toContain("cursor.style.opacity = '0'");
  });

  test('a first cursor on a page starts at the centre of the window and glides to its target', () => {
    const page = fakePage({ readyState: 'complete' });
    page.run(agentCursorScript(300, 400, 'click'));
    expect(page.transforms()).toEqual(['translate(497px, 298px)', 'translate(297px, 398px)']);
  });

  test('a cursor already on the page glides from where it rests to the next target', () => {
    const page = fakePage({ readyState: 'complete' });
    page.run(agentCursorScript(120, 210, 'click'));
    page.run(agentCursorScript(300, 400, 'point'));
    expect(page.transforms().at(-1)).toBe('translate(297px, 398px)');
    expect(page.cursors()).toBe(1);
  });

  test('each pointed target is remembered for the next page of the same site', () => {
    const page = fakePage({ readyState: 'complete' });
    page.run(agentCursorScript(120, 210, 'click'));
    expect(JSON.parse(page.stored() ?? 'null')).toEqual({ x: 120, y: 210 });
  });

  test('every new page draws the cursor where it last rested on that site as soon as the page is parsed', () => {
    const page = fakePage({ readyState: 'loading', saved: JSON.stringify({ x: 120, y: 210 }) });
    page.run(AGENT_CURSOR_INIT_SCRIPT);
    expect(page.cursors()).toBe(0);
    page.parsed();
    expect(page.cursors()).toBe(1);
    expect(page.transforms().at(-1)).toBe('translate(117px, 208px)');
  });

  test('a page on a site the cursor has not visited shows it at the centre of the window', () => {
    const page = fakePage({ readyState: 'interactive' });
    page.run(AGENT_CURSOR_INIT_SCRIPT);
    expect(page.transforms().at(-1)).toBe('translate(497px, 298px)');
  });

  test('the page script leaves frames and an existing cursor alone', () => {
    const frame = fakePage({ readyState: 'complete', frame: true });
    frame.run(AGENT_CURSOR_INIT_SCRIPT);
    expect(frame.cursors()).toBe(0);
    const page = fakePage({ readyState: 'complete', saved: JSON.stringify({ x: 5, y: 5 }) });
    page.run(agentCursorScript(300, 400, 'point'));
    page.run(AGENT_CURSOR_INIT_SCRIPT);
    expect(page.cursors()).toBe(1);
    expect(page.transforms().at(-1)).toBe('translate(297px, 398px)');
  });

  test('a saved point that is not a pair of numbers falls back to the centre', () => {
    const page = fakePage({ readyState: 'complete', saved: '{"x":"1e9px","y":null}' });
    page.run(AGENT_CURSOR_INIT_SCRIPT);
    expect(page.transforms().at(-1)).toBe('translate(497px, 298px)');
  });

  test('every browser call writes the cursor page script into the computer and registers it at browser launch', async () => {
    const log: string[] = [];
    const written: Array<[string, string]> = [];
    const provider: ComputerProvider = {
      ...cursorProvider(log),
      async writeFile(path, content) {
        written.push([path, content]);
      },
    };
    await runBrowserTool(
      provider,
      'browser_act',
      { actions: [{ kind: 'click', ref: 'e1' }] },
      { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [], session: 's' },
    );
    expect(written).toEqual([[AGENT_CURSOR_INIT_PATH, AGENT_CURSOR_INIT_SCRIPT]]);
    const browserLines = log.filter((line) => line.startsWith('agent-browser '));
    expect(browserLines.length).toBeGreaterThan(0);
    for (const line of browserLines) {
      expect(line).toContain(` --init-script ${AGENT_CURSOR_INIT_PATH} `);
    }
  });

  test('a call whose page script cannot be written still runs, without registering it', async () => {
    const log: string[] = [];
    const provider: ComputerProvider = {
      ...cursorProvider(log),
      async writeFile() {
        throw new Error('disk full');
      },
    };
    await runBrowserTool(
      provider,
      'browser_act',
      { actions: [{ kind: 'click', ref: 'e1' }] },
      { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [], session: 's' },
    );
    expect(log.some((line) => line.endsWith(' click @e1'))).toBe(true);
    expect(log.some((line) => line.includes('--init-script'))).toBe(false);
  });

  test('filling a field clears it, focuses it and types the text key by key like a person', async () => {
    const log: string[] = [];
    await runBrowserTool(
      cursorProvider(log),
      'browser_act',
      { actions: [{ kind: 'fill', ref: 'e1', text: 'hello' }] },
      {
        timeoutMs: 30_000,
        signal: new AbortController().signal,
        cairnOrigins: [],
        session: 'typing',
      },
    );
    const typed = log.filter((line) => line.includes(' keyboard type '));
    expect(typed.map((line) => line.split(' keyboard type ')[1])).toEqual([
      'h',
      'e',
      'l',
      'l',
      'o',
    ]);
    const clear = log.findIndex((line) => line.endsWith(' fill @e1 '));
    const focus = log.findIndex((line) => line.endsWith(' focus @e1'));
    const first = log.findIndex((line) => line.includes(' keyboard type '));
    expect(clear).toBeGreaterThan(-1);
    expect(focus).toBeGreaterThan(clear);
    expect(first).toBeGreaterThan(focus);
    expect(log.some((line) => line.endsWith(' fill @e1 hello'))).toBe(false);
  });

  test('long text is typed in at most 24 bursts that add up to the text', async () => {
    const log: string[] = [];
    const text = 'The deployment checks passed and the change is ready for review. '.repeat(2);
    await runBrowserTool(
      cursorProvider(log),
      'browser_act',
      { actions: [{ kind: 'type', ref: 'e1', text }] },
      {
        timeoutMs: 60_000,
        signal: new AbortController().signal,
        cairnOrigins: [],
        session: 'typing-long',
      },
    );
    const bursts = log
      .filter((line) => line.includes(' keyboard type '))
      .map((line) => line.slice(line.indexOf(' keyboard type ') + ' keyboard type '.length));
    expect(bursts.length).toBeLessThanOrEqual(24);
    expect(bursts.join('')).toBe(text);
  });

  test('the cursor never blocks the action when the box or the drawing fails', async () => {
    const clickIn = (provider: ComputerProvider, session: string) =>
      runBrowserTool(
        provider,
        'browser_act',
        { actions: [{ kind: 'click', ref: 'e1' }] },
        { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: [], session },
      );
    const noBox: string[] = [];
    await clickIn(cursorProvider(noBox, { box: { text: 'not found', code: 1 } }), 'nobox');
    expect(noBox.some((line) => line.includes('__cairnAgentCursor'))).toBe(false);
    expect(noBox.some((line) => line.endsWith(' click @e1'))).toBe(true);
    const noDraw: string[] = [];
    await clickIn(cursorProvider(noDraw, { evalCode: 1 }), 'nodraw');
    expect(noDraw.some((line) => line.endsWith(' click @e1'))).toBe(true);
  });

  test('the cursor is hidden from the accessibility tree and never takes a click', () => {
    const script = agentCursorScript(1, 2, 'click');
    expect(script).toContain("'aria-hidden', 'true'");
    expect(script).toContain('pointer-events:none');
    expect(() => agentCursorScript(Number.NaN, 2, 'click')).toThrow();
    const styles = [...script.matchAll(/cssText = '([^']*)'/g)].map((match) => match[1] ?? '');
    expect(styles.length).toBeGreaterThanOrEqual(4);
    for (const style of styles) expect(style).toContain('pointer-events:none');
  });
});

function addressBarProvider(
  log: string[],
  options: { window?: string; url?: string; title?: string } = {},
): ComputerProvider {
  return {
    async execute(request) {
      const line = request.argv.join(' ');
      log.push(line);
      const respond = (text: string, code = 0) =>
        (async function* () {
          if (text !== '') yield { kind: 'stdout' as const, text };
          yield { kind: 'exit' as const, code };
        })();
      if (line.startsWith('xdotool search')) {
        return options.window === undefined ? respond('', 1) : respond(`${options.window}\n`);
      }
      if (line.endsWith(' get url')) return respond(`${options.url ?? 'https://example.com/'}\n`);
      if (line.endsWith(' get title'))
        return respond(`[agent-browser] restore: loaded\n${options.title ?? 'Example Domain'}\n`);
      if (line.includes(' eval ')) return respond('{"success":true,"data":{"result":[]}}');
      return respond('ok\n');
    },
    async listFiles() {
      return [];
    },
    async readFile() {
      return '';
    },
    async writeFile() {},
    async killAll() {},
  };
}

describe('opening a page like a person', () => {
  const navigate = (provider: ComputerProvider, url = 'https://example.com') =>
    runBrowserTool(
      provider,
      'browser_navigate',
      { url },
      {
        timeoutMs: 60_000,
        signal: new AbortController().signal,
        cairnOrigins: [],
        session: 'omnibox',
      },
    );

  test('the URL is typed into the address bar and entered instead of jumping straight to it', async () => {
    const log: string[] = [];
    const result = await navigate(addressBarProvider(log, { window: '42' }));
    const focus = log.findIndex((line) =>
      line.includes('xdotool windowactivate --sync 42 key --clearmodifiers ctrl+l'),
    );
    const typed = log.findIndex((line) =>
      /^xdotool type --delay \d+ https:\/\/example\.com\/$/.test(line),
    );
    const enter = log.findIndex((line) => line === 'xdotool key Return');
    expect(focus).toBeGreaterThan(-1);
    expect(typed).toBeGreaterThan(focus);
    expect(enter).toBeGreaterThan(typed);
    expect(log.some((line) => line.endsWith(' open https://example.com/'))).toBe(false);
    expect(result.text).toContain('Example Domain');
    expect(result.text).toContain('https://example.com/');
  });

  test('the address bar of the session window is used when other browsers are open', async () => {
    const log: string[] = [];
    await navigate(addressBarProvider(log, { window: '42', title: 'Example Domain (v2)' }));
    const search = log.find((line) => line.startsWith('xdotool search'));
    expect(search).toBe('xdotool search --onlyvisible --name ^Example Domain \\(v2\\) - Chromium$');
  });

  test('two windows showing the same page are ambiguous, so it opens the URL directly', async () => {
    const log: string[] = [];
    await navigate(addressBarProvider(log, { window: '41\n42' }));
    expect(log.some((line) => line.startsWith('xdotool type'))).toBe(false);
    expect(log.some((line) => line.endsWith(' open https://example.com/'))).toBe(true);
  });

  test('without a browser window it opens a blank page first and still types the URL', async () => {
    const log: string[] = [];
    let searches = 0;
    const provider = addressBarProvider(log, { window: '7' });
    const firstSearchMisses: ComputerProvider = {
      ...provider,
      async execute(request) {
        if (request.argv[0] === 'xdotool' && request.argv[1] === 'search' && searches++ === 0) {
          log.push(request.argv.join(' '));
          return (async function* () {
            yield { kind: 'exit' as const, code: 1 };
          })();
        }
        return provider.execute(request);
      },
    };
    await navigate(firstSearchMisses);
    expect(log.some((line) => line.endsWith(' open about:blank'))).toBe(true);
    expect(log.some((line) => line.startsWith('xdotool type --delay'))).toBe(true);
  });

  test('a page that fails to load in the address bar is reported as a failed navigation', async () => {
    const log: string[] = [];
    await expect(
      navigate(addressBarProvider(log, { window: '42', url: 'chrome-error://chromewebdata/' })),
    ).rejects.toMatchObject({ delivery: 'unknown' });
  });

  test('when the typed address turns into a search, it opens the URL directly', async () => {
    const log: string[] = [];
    await navigate(
      addressBarProvider(log, {
        window: '42',
        url: 'https://www.google.com/search?q=s%3A%2F%2Fwww.zhipin.com%2F',
        title: 's://www.zhipin.com/ - Google Search',
      }),
      'https://www.zhipin.com/',
    );
    expect(log.some((line) => line.startsWith('xdotool type'))).toBe(true);
    expect(log.some((line) => line.endsWith(' open https://www.zhipin.com/'))).toBe(true);
  });

  test('a redirect to a subdomain of the same site is accepted without reopening', async () => {
    const log: string[] = [];
    await navigate(
      addressBarProvider(log, { window: '42', url: 'https://m.zhipin.com/web/' }),
      'https://www.zhipin.com/',
    );
    expect(log.some((line) => line.endsWith(' open https://www.zhipin.com/'))).toBe(false);
  });
});

describe('Cairn pages', () => {
  const CAIRN = ['http://127.0.0.1:8787'];
  const none = async () => [] as string[];

  const tabsJson = (targetId: string) =>
    `${JSON.stringify({ success: true, data: { tabs: [{ active: true, targetId }] } })}\n`;

  function pageAt(
    log: string[],
    pages: string[],
    blockExit = 0,
    tabs: string[] = ['T1'],
  ): ComputerProvider {
    let current = pages[0] ?? 'about:blank';
    let tabReads = 0;
    return {
      async execute(request) {
        const line = request.argv.join(' ');
        log.push(line);
        return (async function* () {
          if (line.includes(' batch --bail ')) {
            yield {
              kind: blockExit === 0 ? ('stdout' as const) : ('stderr' as const),
              text: blockExit === 0 ? 'ok\n' : 'Chrome exited before providing DevTools URL\n',
            };
            yield { kind: 'exit' as const, code: blockExit };
            return;
          }
          if (line.endsWith(' --json tab list')) {
            const tab = tabs[Math.min(tabReads, tabs.length - 1)] ?? 'T1';
            tabReads += 1;
            yield { kind: 'stdout' as const, text: tabsJson(tab) };
            yield { kind: 'exit' as const, code: 0 };
            return;
          }
          if (line.endsWith(' snapshot -i')) {
            yield { kind: 'stdout' as const, text: '- textbox "Search" [ref=e1]\n' };
            yield { kind: 'exit' as const, code: 0 };
            return;
          }
          if (line.endsWith(' --json get url')) {
            yield {
              kind: 'stdout' as const,
              text: '⚠ Chrome is behind the current stable release\n',
            };
            yield {
              kind: 'stdout' as const,
              text: `${JSON.stringify({ success: true, data: { url: current } })}\n`,
            };
          } else {
            if (/ open (?!about:blank)/.test(line)) current = pages[1] ?? current;
            yield { kind: 'stdout' as const, text: 'ok\n' };
          }
          yield { kind: 'exit' as const, code: 0 };
        })();
      },
      async listFiles() {
        return [];
      },
      async readFile() {
        return '';
      },
      async writeFile() {},
      async killAll() {},
    };
  }
  const run = { timeoutMs: 5_000, signal: new AbortController().signal, cairnOrigins: CAIRN };

  test('every address that reaches this machine on the Cairn port is Cairn', async () => {
    for (const url of [
      'http://127.0.0.1:8787/app',
      'http://localhost:8787/',
      'http://LOCALHOST:8787',
      'http://[::1]:8787/',
      'http://127.9.9.9:8787/',
      'http://2130706433:8787/',
      'http://0x7f.1:8787/',
      'http://[::ffff:127.0.0.1]:8787/',
      'http://0.0.0.0:8787/',
      'http://app.localhost:8787/',
      'http://192.168.1.20:8787/',
    ]) {
      expect(await isCairnPage(url, CAIRN, none, ['192.168.1.20']), url).toBe(true);
    }
  });

  test('a name that resolves to this machine, or does not resolve, counts on the Cairn port', async () => {
    expect(
      await isCairnPage('http://rebind.example:8787/', CAIRN, async () => ['127.0.0.1'], []),
    ).toBe(true);
    const failing = async (): Promise<string[]> => {
      throw new Error('ENOTFOUND');
    };
    expect(await isCairnPage('http://gone.example:8787/', CAIRN, failing, [])).toBe(true);
  });

  test('other ports, other machines and configured public origins are told apart', async () => {
    const remote = async () => ['93.184.216.34'];
    expect(await isCairnPage('http://127.0.0.1:3000/', CAIRN, none, [])).toBe(false);
    expect(await isCairnPage('http://site.example:8787/', CAIRN, remote, [])).toBe(false);
    expect(await isCairnPage('https://example.com/', CAIRN, remote, [])).toBe(false);
    const origins = [...CAIRN, 'https://cairn.tail1234.ts.net'];
    expect(await isCairnPage('https://cairn.tail1234.ts.net/app', origins, remote, [])).toBe(true);
    expect(await isCairnPage('https://other.tail1234.ts.net/', origins, remote, [])).toBe(false);
  });

  test('navigating to Cairn is refused before anything runs', async () => {
    const log: string[] = [];
    await expect(
      runBrowserTool(
        pageAt(log, ['about:blank']),
        'browser_navigate',
        { url: 'http://localhost:8787/app' },
        run,
      ),
    ).rejects.toMatchObject({
      delivery: 'not_delivered',
      message: expect.stringMatching(/is Cairn itself/),
    });
    expect(log.some((line) => / open /.test(line))).toBe(false);
  });

  test('a page that redirects to Cairn is left for a blank page and refused', async () => {
    const log: string[] = [];
    await expect(
      runBrowserTool(
        pageAt(log, ['about:blank', 'http://127.0.0.1:8787/app']),
        'browser_navigate',
        { url: 'https://example.com/' },
        {
          ...run,
          isCairnPage: (url, origins) =>
            isCairnPage(url, origins, async () => ['93.184.216.34'], []),
        },
      ),
    ).rejects.toThrow(/127\.0\.0\.1:8787\/app is Cairn itself/);
    expect(log.at(-1)).toMatch(/ open about:blank$/);
  });

  test('acting or reading on a Cairn page is refused without clicking', async () => {
    for (const [tool, params] of [
      ['browser_act', { actions: [{ kind: 'click', ref: 'e1' }] }],
      ['browser_snapshot', {}],
    ] as const) {
      const log: string[] = [];
      await expect(
        runBrowserTool(pageAt(log, ['http://127.0.0.1:8787/app']), tool, params, run),
      ).rejects.toThrow(/is Cairn itself/);
      expect(log.some((line) => / (click|snapshot)/.test(line))).toBe(false);
    }
  });

  test('an ordinary page is still opened and clicked', async () => {
    const log: string[] = [];
    const site = {
      ...run,
      isCairnPage: (url: string, origins: readonly string[]) =>
        isCairnPage(url, origins, async () => ['93.184.216.34'], []),
    };
    await runBrowserTool(
      pageAt(log, ['about:blank', 'https://example.com/']),
      'browser_navigate',
      { url: 'https://example.com/' },
      site,
    );
    const acting: string[] = [];
    await runBrowserTool(
      pageAt(acting, ['https://example.com/']),
      'browser_act',
      { actions: [{ kind: 'press', text: 'Enter' }] },
      site,
    );
    expect(acting.some((line) => line.endsWith(' press Enter'))).toBe(true);
  });

  test('every call first blocks the loopback names on each Cairn port inside the browser', async () => {
    const log: string[] = [];
    await runBrowserTool(pageAt(log, ['https://example.com/']), 'browser_snapshot', {}, run);
    const block = log.find((line) => line.includes(' batch --bail '));
    expect(log.indexOf(block ?? '')).toBe(0);
    for (const pattern of [
      'http://127.0.0.1:8787/*',
      'http://localhost:8787/*',
      'http://[::1]:8787/*',
      'https://localhost:8787/*',
    ]) {
      expect(block).toContain(`network route ${pattern} --abort`);
    }
  });

  test('when Cairn cannot be blocked in the browser, nothing runs', async () => {
    const log: string[] = [];
    await expect(
      runBrowserTool(
        pageAt(log, ['https://example.com/'], 1),
        'browser_act',
        { actions: [{ kind: 'press', text: 'Enter' }] },
        run,
      ),
    ).rejects.toMatchObject({
      delivery: 'not_delivered',
      message: expect.stringMatching(
        /could not be blocked.*Chrome exited before providing DevTools URL/,
      ),
    });
    expect(log).toHaveLength(1);
  });

  test('a URL with line breaks, tabs or spaces is refused before anything is typed or opened', async () => {
    for (const url of [
      'http://127.0.0.1:8787\n.evil.com/',
      'http://127.0.0.1:8787\n\t\t\t\n:x',
      'https://example.com/a b',
      'http://[bad',
    ]) {
      const log: string[] = [];
      await expect(
        runBrowserTool(pageAt(log, ['about:blank']), 'browser_navigate', { url }, run),
        JSON.stringify(url),
      ).rejects.toMatchObject({ delivery: 'not_delivered' });
      expect(log.some((line) => / open |xdotool type/.test(line))).toBe(false);
    }
  });

  test('a page whose address cannot be read, or a Cairn blob, is refused', async () => {
    expect(await isCairnPage('blob:http://127.0.0.1:8787/0b1c', CAIRN, none, [])).toBe(true);
    expect(await isCairnPage('http://%zz:8787/', CAIRN, none, [])).toBe(true);
    expect(await isCairnPage('about:blank', CAIRN, none, [])).toBe(false);
    const unreadable: ComputerProvider = {
      ...pageAt([], ['https://example.com/']),
      async execute(request) {
        return (async function* () {
          yield {
            kind: 'stdout' as const,
            text: request.argv.includes('url')
              ? 'webmcp: tools changed\n'
              : request.argv.includes('tab')
                ? tabsJson('T1')
                : 'ok\n',
          };
          yield { kind: 'exit' as const, code: 0 };
        })();
      },
    };
    await expect(runBrowserTool(unreadable, 'browser_snapshot', {}, run)).rejects.toThrow(
      /address could not be read/,
    );
  });

  test('a tab that becomes active between the address check and the click gets no click', async () => {
    const log: string[] = [];
    await expect(
      runBrowserTool(
        pageAt(log, ['https://example.com/'], 0, ['T1', 'T2']),
        'browser_act',
        { actions: [{ kind: 'press', text: 'Enter' }] },
        run,
      ),
    ).rejects.toThrow(/another tab became active/);
    expect(log.some((line) => line.endsWith(' press Enter'))).toBe(false);
  });

  test('the block is renewed on the bound tab right before each action runs', async () => {
    const log: string[] = [];
    await runBrowserTool(
      pageAt(log, ['https://example.com/']),
      'browser_act',
      { actions: [{ kind: 'press', text: 'Enter' }] },
      run,
    );
    const press = log.findIndex((line) => line.endsWith(' press Enter'));
    const lastBlock = log.findLastIndex((line) => line.includes(' batch --bail '));
    expect(lastBlock).toBeGreaterThan(0);
    expect(lastBlock).toBeLessThan(press);
    expect(log[lastBlock]).toContain('network unroute http://127.0.0.1:8787/*');
  });

  test('a tab that becomes active while typing gets none of the remaining keystrokes', async () => {
    const log: string[] = [];
    await expect(
      runBrowserTool(
        pageAt(log, ['https://example.com/'], 0, ['T1', 'T1', 'T1', 'T1', 'T2']),
        'browser_act',
        { actions: [{ kind: 'fill', ref: 'e1', text: 'abc\t\t\n' }] },
        { ...run, timeoutMs: 60_000 },
      ),
    ).rejects.toThrow(/another tab became active/);
    expect(log.some((line) => line.includes(' focus @e1'))).toBe(true);
    expect(log.some((line) => line.includes(' keyboard type '))).toBe(false);
  });

  test('a snapshot taken after another tab became active is thrown away', async () => {
    await expect(
      runBrowserTool(
        pageAt([], ['https://example.com/'], 0, ['T1', 'T2']),
        'browser_snapshot',
        {},
        run,
      ),
    ).rejects.toThrow(/another tab became active/);
  });
});
