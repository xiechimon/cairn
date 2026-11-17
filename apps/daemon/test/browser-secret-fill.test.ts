import { createContext, runInContext } from 'node:vm';
import { describe, expect, test } from 'vitest';
import { runBrowserTool } from '../src/computer/browser.js';
import type { ComputerProvider } from '../src/computer/provider.js';

function page(
  options: {
    origin?: string;
    type?: string;
    autocomplete?: string;
    action?: string;
    frame?: boolean;
    reveal?: boolean;
    login?: { type?: string; autocomplete?: string } | null;
  } = {},
) {
  const origin = options.origin ?? 'https://login.example.com';
  const loginDecl =
    options.login === undefined || options.login === null
      ? 'var login = null;'
      : `var login = new HTMLInputElement();
    login.type = ${JSON.stringify(options.login.type ?? 'text')};
    login.autocomplete = ${JSON.stringify(options.login.autocomplete ?? 'username')};
    login.ownerDocument = document;`;
  const context = createContext({ URL });
  runInContext(
    `
    var location = { origin: ${JSON.stringify(origin)}, href: ${JSON.stringify(`${origin}/login`)} };
    var window = globalThis;
    window.top = ${options.frame ? '{}' : 'window'};
    class HTMLInputElement {
      type = ${JSON.stringify(options.type ?? 'password')};
      autocomplete = ${JSON.stringify(options.autocomplete ?? 'current-password')};
      disabled = false;
      readOnly = false;
      get value() { return this.saved || ''; }
      set value(value) { this.saved = value; }
      getBoundingClientRect() { return { width: 100, height: 30 }; }
      dispatchEvent() {}
    }
    var input = new HTMLInputElement();
    var document = {
      activeElement: input,
      querySelectorAll: (selector) =>
        selector === 'input' ? [login, input].filter((el) => el !== null) : [],
    };
    input.ownerDocument = document;
    ${loginDecl}
    input.form = {
      action: ${JSON.stringify(options.action ?? `${origin}/session`)},
      elements: [login, input].filter((el) => el !== null),
    };
    var getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
    class Event {}
  `,
    context,
  );
  const argv: string[] = [];
  const stdin: string[] = [];
  const provider: ComputerProvider = {
    async execute(request) {
      argv.push(...request.argv);
      let text = '- textbox "Password" [ref=e1]';
      if (request.stdin !== undefined) {
        stdin.push(request.stdin);
        const result = runInContext(request.stdin, context);
        if (options.reveal && runInContext('input.value', context) !== '')
          throw new Error(String(runInContext('input.value', context)));
        text = JSON.stringify({ data: { result } });
      }
      return (async function* () {
        yield { kind: 'stdout' as const, text };
        yield { kind: 'exit' as const, code: 0 };
      })();
    },
    async writeFile() {},
    async readFile() {
      return '';
    },
    async listFiles() {
      return [];
    },
    async killAll() {},
  };
  return {
    provider,
    argv,
    stdin,
    value: () => runInContext('input.value', context),
    loginValue: () => runInContext('login === null ? null : login.value', context),
  };
}

const value = 'synthetic "password" \\ +&';
const username = 'synthetic-user@example.com';
const run = (
  provider: ComputerProvider,
  extra: Record<string, unknown> = {},
  secrets?: { name: string; origin: string; value: string; username?: string }[],
) =>
  runBrowserTool(
    provider,
    'browser_act',
    {
      actions: [
        {
          kind: 'fill_secret',
          ref: 'e1',
          secret: 'LOGIN',
          origin: 'https://login.example.com',
          ...extra,
        },
      ],
    },
    {
      cairnOrigins: [],
      timeoutMs: 5000,
      signal: new AbortController().signal,
      browserSecrets: secrets ?? [{ name: 'LOGIN', origin: 'https://login.example.com', value }],
    },
  );

describe('saved browser password filling', () => {
  test('fills the current password and returns no credential through output or argv', async () => {
    const target = page();
    expect((await run(target.provider)).text).toBe('Saved browser password filled.');
    expect(target.value()).toBe(value);
    expect(target.argv.join(' ')).not.toContain(value);
    expect(target.stdin).toHaveLength(2);
    expect(target.stdin[0]).not.toContain(JSON.stringify(value));
  });

  test('a username+password pair fills both fields of the same form', async () => {
    const target = page({ login: { type: 'text', autocomplete: 'username' } });
    expect(
      (
        await run(target.provider, {}, [
          { name: 'LOGIN', origin: 'https://login.example.com', value, username },
        ])
      ).text,
    ).toBe('Saved browser password filled.');
    expect(target.value()).toBe(value);
    expect(target.loginValue()).toBe(username);
    expect(target.argv.join(' ')).not.toContain(username);
    expect(target.argv.join(' ')).not.toContain(value);
    expect(target.stdin).toHaveLength(2);
    expect(target.stdin[0]).not.toContain(JSON.stringify(username));
    expect(target.stdin[0]).not.toContain(JSON.stringify(value));
  });

  test('a pair fill refuses the whole action when no login field exists', async () => {
    const target = page();
    await expect(
      run(target.provider, {}, [
        { name: 'LOGIN', origin: 'https://login.example.com', value, username },
      ]),
    ).rejects.toThrow('could not be confirmed');
    expect(target.value()).toBe('');
    expect(target.stdin).toHaveLength(1);
    const stray = page({ login: { type: 'text', autocomplete: 'one-time-code' } });
    await expect(
      run(stray.provider, {}, [
        { name: 'LOGIN', origin: 'https://login.example.com', value, username },
      ]),
    ).rejects.toThrow('could not be confirmed');
    expect(stray.loginValue()).toBe('');
  });

  test.each([
    { origin: 'https://other.example.com' },
    { origin: 'https://login.example.com:8443' },
    { type: 'text' },
    { autocomplete: 'new-password' },
    { autocomplete: 'one-time-code' },
    { action: 'https://other.example.com/session' },
    { frame: true },
  ])('refuses an unauthorized page or field: %j', async (options) => {
    const target = page(options);
    await expect(run(target.provider)).rejects.toThrow('could not be confirmed');
    expect(target.value()).toBe('');
    expect(target.stdin).toHaveLength(1);
  });

  test('literal text is rejected and raw eval errors never leave the bridge', async () => {
    const target = page();
    await expect(run(target.provider, { text: value })).rejects.toThrow('actions list');
    expect(target.value()).toBe('');
    const leaking = page({ reveal: true });
    await expect(run(leaking.provider)).rejects.toThrow(
      'Saved password fill could not be confirmed',
    );
  });
});
