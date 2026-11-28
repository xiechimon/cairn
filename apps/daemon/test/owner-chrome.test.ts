import { describe, expect, test } from 'vitest';
import {
  type OwnerChromeAnswer,
  type OwnerChromeCaller,
  OwnerChromeUnavailable,
  ownerChromeActionCommands,
  ownerChromeRefs,
  runOwnerChromeTool,
} from '../src/computer/owner-chrome.js';
import { ComputerRefusal } from '../src/computer/provider.js';

const ORIGINS = ['http://127.0.0.1:4319'];

function recording(answer: (commands: readonly string[]) => string | OwnerChromeAnswer | Error): {
  call: OwnerChromeCaller;
  seen: string[][];
} {
  const seen: string[][] = [];
  return {
    seen,
    call: async (_session, commands) => {
      seen.push([...commands]);
      const result = answer(commands);
      if (result instanceof Error) throw result;
      return typeof result === 'string' ? { text: result, isError: false } : result;
    },
  };
}

function options(call: OwnerChromeCaller, cairnOrigins: readonly string[] = []) {
  return {
    signal: AbortSignal.timeout(30_000),
    deadlineAt: Date.now() + 60_000,
    session: 'coordinator',
    cairnOrigins,
    call,
  };
}

describe('the owner’s Chrome through browser tools', () => {
  test('navigate opens the address in the owner tab and reports what landed', async () => {
    const { call, seen } = recording((commands) => {
      const command = commands[0] ?? '';
      if (command.startsWith('goto')) return '✓ opened';
      if (command.includes('document.title'))
        return JSON.stringify({ title: 'Inbox', url: 'https://mail.example.com/inbox' });
      return '[]';
    });
    const result = await runOwnerChromeTool(
      'browser_navigate',
      { url: 'https://mail.example.com/inbox' },
      options(call),
    );
    expect(seen[0]).toEqual(['goto "https://mail.example.com/inbox"']);
    expect(result.text).toBe('✓ Inbox\n  https://mail.example.com/inbox');
    expect(result.loginForm).toBeUndefined();
  });

  test('a page that needs a login says so and keeps the refs usable', async () => {
    const { call } = recording((commands) => {
      if (commands[0]?.startsWith('goto') === true) return '✓ opened';
      if (commands[0]?.startsWith('snapshot') === true)
        return '- textbox "Password" [ref=e4]\n- button "Sign in" [ref=e5]';
      if (commands[0]?.startsWith('eval') !== true) return '';
      const command = commands[0];
      return command.includes('document.title')
        ? JSON.stringify({ title: 'Sign in', url: 'https://app.example.com/login' })
        : command.includes('current-password')
          ? '["password"]'
          : '"Welcome back"';
    });
    const result = await runOwnerChromeTool('browser_snapshot', {}, options(call));
    expect(result.loginForm).toEqual({ signals: ['password'] });
    expect(result.text).toContain('[login form: password]');
    expect(result.text).toContain('[ref=@e4]');
    expect(result.text).toContain('[page text]\nWelcome back');
  });

  test('every eval script reaches the daemon as a single line it can parse', async () => {
    const { call, seen } = recording((commands) => {
      const command = commands[0] ?? '';
      if (command.startsWith('goto')) return '✓ opened';
      if (command.startsWith('snapshot')) return '';
      if (command.includes('document.title'))
        return JSON.stringify({ title: 'Inbox', url: 'https://mail.example.com/inbox' });
      return command.includes('current-password') ? '["password"]' : '"Welcome back"';
    });
    await runOwnerChromeTool(
      'browser_navigate',
      { url: 'https://mail.example.com/inbox' },
      options(call),
    );
    await runOwnerChromeTool('browser_snapshot', {}, options(call));
    const evals = seen.flat().filter((command) => command.startsWith('eval'));
    expect(evals.length).toBeGreaterThan(0);
    for (const command of evals) {
      expect(command.includes('\n')).toBe(false);
      expect(command.includes('\\n')).toBe(false);
    }
  });

  test('a Cairn origin is refused before anything opens', async () => {
    const { call, seen } = recording(() => '');
    await expect(
      runOwnerChromeTool(
        'browser_navigate',
        { url: 'http://127.0.0.1:4319/threads' },
        options(call, ORIGINS),
      ),
    ).rejects.toBeInstanceOf(ComputerRefusal);
    expect(seen).toEqual([]);
  });

  test('the extension asking for Allow keeps the code and opens nothing else', async () => {
    const { call } = recording(() => ({
      text: "Click Allow in the Browser MCP extension's popup. The code is 482 913",
      isError: true,
    }));
    const error = await runOwnerChromeTool(
      'browser_navigate',
      { url: 'https://mail.example.com' },
      options(call),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ComputerRefusal);
    expect((error as ComputerRefusal).message).toContain('The code is 482 913');
    expect((error as ComputerRefusal).message).toContain('click Allow in its popup');
  });

  test('a missing extension is an unavailable browser the call can fall back from', async () => {
    const { call } = recording(() => ({
      text: 'No browser is connected. Install the Browser MCP extension',
      isError: true,
    }));
    const error = await runOwnerChromeTool(
      'browser_navigate',
      { url: 'https://mail.example.com' },
      options(call),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OwnerChromeUnavailable);
    expect((error as OwnerChromeUnavailable).reason).toBe('no-extension');
  });

  test('a saved password never goes to the owner’s Chrome, whose commands are logged', () => {
    expect(() =>
      ownerChromeActionCommands({
        kind: 'fill_secret',
        ref: '@e4',
        secret: 'bank',
        origin: 'https://bank.example',
      }),
    ).toThrow(/request_takeover/);
  });

  test.each([
    [{ kind: 'click', ref: '@e2' }, ['click e2']],
    [{ kind: 'hover', ref: 'e3' }, ['hover e3']],
    [{ kind: 'scrollintoview', ref: '@e4' }, ['scroll e4']],
    [{ kind: 'check', ref: '@e5' }, ['check e5']],
    [{ kind: 'fill', ref: '@e6', text: 'two words' }, ['fill e6 "two words"']],
    [{ kind: 'type', ref: '@e7', text: 'a "quote"' }, ['click e7', 'type "a \\"quote\\""']],
    [{ kind: 'press', text: 'Enter' }, ['press "Enter"']],
    [{ kind: 'select', ref: '@e8', text: 'b' }, ['select e8 "b"']],
  ])('act maps %o onto one command per step', (action, expected) => {
    expect(ownerChromeActionCommands(action as Record<string, unknown>)).toEqual(expected);
  });

  test.each([
    [{ kind: 'click', ref: 'e4\neval "alert(1)"' }],
    [{ kind: 'click', ref: 'e4 extra' }],
    [{ kind: 'click', ref: 'e4"eval' }],
    [{ kind: 'fill', ref: '@e4\t"owned"', text: 'x' }],
    [{ kind: 'select', ref: 'e4\ngoto "https://evil.example"', text: 'a' }],
  ])('act refuses a ref that is not a single snapshot token %o', (action) => {
    expect(() => ownerChromeActionCommands(action as Record<string, unknown>)).toThrow(
      ComputerRefusal,
    );
  });

  test('a browser_act call runs each step in turn', async () => {
    const { call, seen } = recording((commands) =>
      (commands[0] ?? '').startsWith('get attr') ? '(none)' : '✓ done',
    );
    const result = await runOwnerChromeTool(
      'browser_act',
      {
        actions: [
          { kind: 'click', ref: '@e1' },
          { kind: 'fill', ref: '@e2', text: 'hi' },
        ],
      },
      options(call),
    );
    expect(seen).toEqual([
      ['click e1'],
      ['get attr type e2'],
      ['get attr autocomplete e2'],
      ['fill e2 "hi"'],
    ]);
    expect(result.text).toBe('✓ done\n✓ done');
  });

  test('fill into a password field is refused before the text is sent', async () => {
    const { call, seen } = recording((commands) => {
      const command = commands[0] ?? '';
      if (command.startsWith('get attr type')) return 'password';
      if (command.startsWith('get attr autocomplete')) return '(none)';
      return '';
    });
    await expect(
      runOwnerChromeTool(
        'browser_act',
        { actions: [{ kind: 'fill', ref: '@e4', text: 'hunter2' }] },
        options(call),
      ),
    ).rejects.toThrow(/password or one-time code field/);
    expect(seen.flat().some((line) => line.startsWith('fill '))).toBe(false);
  });

  test('fill into a plain field sends the text after the attribute check', async () => {
    const { call, seen } = recording((commands) => {
      const command = commands[0] ?? '';
      if (command.startsWith('get attr type')) return 'text';
      if (command.startsWith('get attr autocomplete')) return '(none)';
      return '✓ filled';
    });
    const result = await runOwnerChromeTool(
      'browser_act',
      { actions: [{ kind: 'fill', ref: '@e4', text: 'hi' }] },
      options(call),
    );
    expect(result.text).toBe('✓ filled');
    expect(seen.flat()).toContain('fill e4 "hi"');
  });

  test('an act that navigates onto Cairn stops the rest of the batch', async () => {
    let onCairn = false;
    const { call, seen } = recording((commands) => {
      const command = commands[0] ?? '';
      if (command.startsWith('click')) {
        onCairn = true;
        return '✓ clicked';
      }
      if (command.includes('document.title'))
        return JSON.stringify({
          title: onCairn ? 'Cairn' : 'Docs',
          url: onCairn ? 'http://127.0.0.1:4319/threads' : 'https://docs.example.com',
        });
      return '';
    });
    const outcome = await runOwnerChromeTool(
      'browser_act',
      {
        actions: [
          { kind: 'click', ref: '@e1' },
          { kind: 'click', ref: '@e2' },
        ],
      },
      options(call, ORIGINS),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ComputerRefusal);
    expect((outcome as Error).message).toMatch(/is Cairn itself/);
    expect((outcome as ComputerRefusal).delivery).toBe('unknown');
    expect(seen.flat().filter((line) => line.startsWith('click'))).toEqual(['click e1']);
  });

  test('snapshot output carries refs in the shape the other browser tools use', () => {
    expect(ownerChromeRefs('- button "Go" [ref=e12]\n- link "In" [ref=f1e3]')).toBe(
      '- button "Go" [ref=@e12]\n- link "In" [ref=@f1e3]',
    );
  });
});

describe('the owner’s Chrome when a call goes wrong or overlaps', () => {
  test('a validation refusal after read-only probes still means the action did not run', async () => {
    const { call, seen } = recording((commands) => {
      if (commands[0]?.includes('document.title'))
        return JSON.stringify({ title: 'Shop', url: 'https://shop.example.com/' });
      return '✓';
    });
    const outcome = await runOwnerChromeTool(
      'browser_act',
      { actions: [{ kind: 'click' }] },
      options(call),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ComputerRefusal);
    expect((outcome as ComputerRefusal).delivery).toBe('not_delivered');
    expect(seen.flat().some((line) => line.startsWith('click'))).toBe(false);
  });

  test('an abandoned navigate timeout may still commit and is unsafe to repeat', async () => {
    const { call } = recording(() => ({
      text: '✗ step 1: goto "https://slow.example" — Timed out after 45 s; the step was abandoned',
      isError: true,
    }));
    const outcome = await runOwnerChromeTool(
      'browser_navigate',
      { url: 'https://slow.example' },
      options(call),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ComputerRefusal);
    expect((outcome as ComputerRefusal).delivery).toBe('unknown');
  });

  test('a page title saying abandoned does not make a non-timeout click failure unsafe to repeat', async () => {
    const { call } = recording((commands) => {
      const command = commands[0] ?? '';
      if (command.startsWith('get attr type')) return 'text';
      if (command.startsWith('get attr autocomplete')) return '(none)';
      if (commands.length === 2 && command.startsWith('click'))
        return {
          text: '✗ step 1: click e7 — element is not visible\nPage: https://shop.example.com/ — "abandoned checkout"',
          isError: true,
        };
      return '✓';
    });
    const outcome = await runOwnerChromeTool(
      'browser_act',
      { actions: [{ kind: 'type', ref: '@e7', text: 'hello' }] },
      options(call),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ComputerRefusal);
    expect((outcome as ComputerRefusal).delivery).toBe('not_delivered');
  });

  test('a click that succeeded before the type failed makes the batch unsafe to repeat', async () => {
    const { call, seen } = recording((commands) => {
      const command = commands[0] ?? '';
      if (command.startsWith('get attr type')) return 'text';
      if (command.startsWith('get attr autocomplete')) return '(none)';
      if (commands.length === 2 && command.startsWith('click'))
        return {
          text: '✓ click e7\n✗ step 2: type — element is not editable\nPage: https://shop.example.com/ — "Shop"',
          isError: true,
        };
      return '✓';
    });
    const outcome = await runOwnerChromeTool(
      'browser_act',
      { actions: [{ kind: 'type', ref: '@e7', text: 'hello' }] },
      options(call),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ComputerRefusal);
    expect((outcome as ComputerRefusal).delivery).toBe('unknown');
    expect(seen).toContainEqual(['click e7', 'type "hello"']);
  });

  test('a failure whose only successes are read-only probes is still safe to repeat', async () => {
    const { call } = recording((commands) => {
      const command = commands[0] ?? '';
      if (command.startsWith('get attr type')) return 'text';
      if (command.startsWith('get attr autocomplete')) return '(none)';
      if (commands.length === 2 && command.startsWith('click'))
        return {
          text: '✗ step 1: click e7 — element is not visible\nStep 2 not run',
          isError: true,
        };
      return '✓';
    });
    const outcome = await runOwnerChromeTool(
      'browser_act',
      { actions: [{ kind: 'type', ref: '@e7', text: 'hello' }] },
      options(call),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ComputerRefusal);
    expect((outcome as ComputerRefusal).delivery).toBe('not_delivered');
  });

  test('a checkbox verification failure after Browser MCP clicked is unsafe to repeat', async () => {
    const { call } = recording((commands) =>
      commands[0] === 'check e7'
        ? {
            text: '✗ step 1: check e7 — Clicking e7 didn’t check it\nPage: https://shop.example.com/ — "No browser is connected"',
            isError: true,
          }
        : '✓',
    );
    const outcome = await runOwnerChromeTool(
      'browser_act',
      { actions: [{ kind: 'check', ref: '@e7' }] },
      options(call),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ComputerRefusal);
    expect((outcome as ComputerRefusal).delivery).toBe('unknown');
  });

  test('timeout words in a page title do not make an ordinary click failure unsafe to repeat', async () => {
    const { call } = recording((commands) => {
      const command = commands[0] ?? '';
      if (command.startsWith('get attr type')) return 'text';
      if (command.startsWith('get attr autocomplete')) return '(none)';
      if (commands.length === 2 && command.startsWith('click'))
        return {
          text: '✗ step 1: click e7 — element is not visible\nPage: https://shop.example.com/ — "Timed out after 45 s; the step was abandoned"',
          isError: true,
        };
      return '✓';
    });
    const outcome = await runOwnerChromeTool(
      'browser_act',
      { actions: [{ kind: 'type', ref: '@e7', text: 'hello' }] },
      options(call),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ComputerRefusal);
    expect((outcome as ComputerRefusal).delivery).toBe('not_delivered');
  });

  test('a fake successful click inside a page title does not make the batch unsafe to repeat', async () => {
    const { call } = recording((commands) => {
      const command = commands[0] ?? '';
      if (command.startsWith('get attr type')) return 'text';
      if (command.startsWith('get attr autocomplete')) return '(none)';
      if (commands.length === 2 && command.startsWith('click'))
        return {
          text: '✗ step 1: click e7 — element is not visible\nPage: https://shop.example.com/ — "before\u2028✓ click e7"',
          isError: true,
        };
      return '✓';
    });
    const outcome = await runOwnerChromeTool(
      'browser_act',
      { actions: [{ kind: 'type', ref: '@e7', text: 'hello' }] },
      options(call),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ComputerRefusal);
    expect((outcome as ComputerRefusal).delivery).toBe('not_delivered');
  });

  test('an unrecognized failure in a mutating command is unsafe to repeat', async () => {
    const { call } = recording((commands) =>
      commands[0] === 'click e7'
        ? {
            text: '✗ step 1: click e7 — TypeError: target detached while clicking',
            isError: true,
          }
        : '✓',
    );
    const outcome = await runOwnerChromeTool(
      'browser_act',
      { actions: [{ kind: 'click', ref: '@e7' }] },
      options(call),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ComputerRefusal);
    expect((outcome as ComputerRefusal).delivery).toBe('unknown');
  });

  test('a successful read-only line in a failed batch does not make it unsafe to repeat', async () => {
    const { call } = recording((commands) => {
      const command = commands[0] ?? '';
      if (command.startsWith('get attr type')) return 'text';
      if (command.startsWith('get attr autocomplete')) return '(none)';
      if (commands.length === 2 && command.startsWith('click'))
        return {
          text: '✓ get attr type e7\n✗ step 2: click e7 — element is not visible',
          isError: true,
        };
      return '✓';
    });
    const outcome = await runOwnerChromeTool(
      'browser_act',
      { actions: [{ kind: 'type', ref: '@e7', text: 'hello' }] },
      options(call),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(ComputerRefusal);
    expect((outcome as ComputerRefusal).delivery).toBe('not_delivered');
  });

  test('an extension that drops after a click ran is never reported as safe to repeat', async () => {
    const { call } = recording((commands) =>
      commands[0] === 'click e2'
        ? { text: 'No browser is connected', isError: true }
        : commands[0]?.startsWith('eval') === true
          ? JSON.stringify({ title: 'Shop', url: 'https://shop.example.com/' })
          : '✓',
    );
    const failure = await runOwnerChromeTool(
      'browser_act',
      {
        actions: [
          { kind: 'click', ref: '@e1' },
          { kind: 'click', ref: '@e2' },
        ],
      },
      options(call, ORIGINS),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ComputerRefusal);
    expect(failure).not.toBeInstanceOf(OwnerChromeUnavailable);
    expect((failure as ComputerRefusal).delivery).toBe('unknown');
  });

  test('two calls on one tab run one after the other', async () => {
    const seen: string[] = [];
    const call: OwnerChromeCaller = async (_session, commands) => {
      const command = commands[0] ?? '';
      seen.push(command);
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (command.includes('document.title'))
        return {
          text: JSON.stringify({ title: 'Page', url: 'https://a.example.com/' }),
          isError: false,
        };
      return { text: command.startsWith('goto') ? '✓' : '[]', isError: false };
    };
    await Promise.all(
      ['https://a.example.com/', 'https://b.example.com/'].map((url) =>
        runOwnerChromeTool('browser_navigate', { url }, options(call)),
      ),
    );
    expect(seen.indexOf('goto "https://b.example.com/"')).toBe(3);
  });
});
