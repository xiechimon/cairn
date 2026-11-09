import { describe, expect, test } from 'vitest';
import { browserSessionName, runBrowserTool } from '../src/computer/browser.js';
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
  });
});

describe('runBrowserTool', () => {
  test('navigates with headed agent-browser open', async () => {
    const log: string[] = [];
    const text = await runBrowserTool(
      recordingProvider(log),
      'browser_navigate',
      { url: 'https://example.com' },
      { timeoutMs: 5_000, signal: new AbortController().signal, session: 'chief:1' },
    );
    expect(text).toContain('ok');
    expect(log[0]).toContain('agent-browser --session chief_1 --headed open https://example.com');
  });

  test('refuses non-http URLs before delivery', async () => {
    await expect(
      runBrowserTool(
        recordingProvider([]),
        'browser_navigate',
        { url: 'file:///etc/passwd' },
        { timeoutMs: 5_000, signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ delivery: 'not_delivered' });
  });

  test('rechecks refs before acting using [ref=eN] snapshot tokens', async () => {
    const log: string[] = [];
    await runBrowserTool(
      recordingProvider(log),
      'browser_act',
      { actions: [{ kind: 'click', ref: 'e1' }] },
      { timeoutMs: 5_000, signal: new AbortController().signal, session: 's' },
    );
    expect(log[0]).toContain('snapshot -i');
    expect(log[1]).toContain('click @e1');
  });

  test('fill and type pass text without a literal -- separator', async () => {
    const log: string[] = [];
    await runBrowserTool(
      recordingProvider(log),
      'browser_act',
      { actions: [{ kind: 'fill', ref: '@e1', text: 'hello' }] },
      { timeoutMs: 5_000, signal: new AbortController().signal, session: 's' },
    );
    expect(log[1]).toBe('agent-browser --session s --headed fill @e1 hello');
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
        { timeoutMs: 5_000, signal: new AbortController().signal },
      ),
    ).rejects.toThrow(/not in a fresh snapshot/);
  });

  test('treats nonzero snapshot exits as failures even when stderr has text', async () => {
    const provider: ComputerProvider = {
      async execute() {
        return (async function* () {
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
        { timeoutMs: 5_000, signal: new AbortController().signal },
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
          if (request.argv.includes('click')) {
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
        { timeoutMs: 5_000, signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ delivery: 'unknown' } satisfies Partial<ComputerRefusal>);
  });
});
