import { describe, expect, test } from 'vitest';
import { runBrowserTool } from '../src/computer/browser.js';
import { type ComputerProvider, ComputerRefusal } from '../src/computer/provider.js';

function recordingProvider(log: string[]): ComputerProvider {
  return {
    async execute(request) {
      log.push(request.argv.join(' '));
      return (async function* () {
        if (request.argv.includes('snapshot')) {
          yield { kind: 'stdout' as const, text: '- button "Go" [ref=@e1]\n' };
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
    expect(log[0]).toContain('agent-browser --session chief:1 --headed open https://example.com');
  });

  test('refuses non-http URLs', async () => {
    await expect(
      runBrowserTool(
        recordingProvider([]),
        'browser_navigate',
        { url: 'file:///etc/passwd' },
        { timeoutMs: 5_000, signal: new AbortController().signal },
      ),
    ).rejects.toBeInstanceOf(ComputerRefusal);
  });

  test('rechecks refs before acting', async () => {
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

  test('refuses when the ref is missing from a fresh snapshot', async () => {
    const provider: ComputerProvider = {
      async execute() {
        return (async function* () {
          yield { kind: 'stdout' as const, text: '- button "Other" [ref=@e9]\n' };
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
});
