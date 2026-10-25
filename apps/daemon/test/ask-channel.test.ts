import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MachineAskResponse } from '@cairn/shared';
import { afterAll, describe, expect, test } from 'vitest';
import { buildHostTools } from '../src/backend/claude-code.js';
import { headlessCaptureUi } from '../src/backend/pi.js';
import { MachineClient } from '../src/machine-client.js';

let server: Server | null = null;
afterAll(() => {
  server?.close();
});

function stubAskServer(
  script: Array<
    (body: { requestId: string; questions: unknown[] }) => { status: number; json?: unknown }
  >,
): { url: string; bodies: { requestId: string; questions: unknown[] }[] } {
  const bodies: { requestId: string; questions: unknown[] }[] = [];
  let next = 0;
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => {
      raw += d;
    });
    req.on('end', () => {
      const body = JSON.parse(raw) as { requestId: string; questions: unknown[] };
      bodies.push(body);
      const step = script[Math.min(next, script.length - 1)];
      next += 1;
      const out = step === undefined ? { status: 500 } : step(body);
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(out.json === undefined ? '' : JSON.stringify(out.json));
    });
  });
  return { url: '', bodies };
}

function listen(): Promise<string> {
  return new Promise((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      const addr = server?.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

const QUESTIONS = [
  {
    header: '缩进',
    question: 'Tabs 还是 spaces？',
    options: [{ label: 'Tabs' }, { label: 'Spaces' }],
  },
];

describe('#1049 machine-client askUser loop', () => {
  test('pending resend with same requestId (D4 idempotent) → resolves once answered', async () => {
    const { bodies } = stubAskServer([
      () => ({
        status: 200,
        json: { status: 'pending', requestId: 'ask-x', answers: null, reason: null },
      }),
      () => ({
        status: 200,
        json: { status: 'pending', requestId: 'ask-x', answers: null, reason: null },
      }),
      () => ({
        status: 200,
        json: {
          status: 'answered',
          requestId: 'ask-x',
          answers: [{ header: '缩进', choices: ['Tabs'] }],
          reason: null,
        },
      }),
    ]);
    const url = await listen();
    const client = new MachineClient({ serverUrl: url });
    const settled = await client.askUser('step-1', {
      requestId: 'ask-x',
      questions: QUESTIONS,
    });
    expect(settled.status).toBe('answered');
    expect(settled.answers?.[0]?.choices).toEqual(['Tabs']);
    expect(bodies.map((b) => b.requestId)).toEqual(['ask-x', 'ask-x', 'ask-x']);
  }, 10_000);

  test('transient 5xx does not end the wait (answer arrives after retry)', async () => {
    stubAskServer([
      () => ({ status: 503 }),
      () => ({
        status: 200,
        json: {
          status: 'cancelled',
          requestId: 'ask-y',
          answers: null,
          reason: '用户取消了本次提问',
        },
      }),
    ]);
    const url = await listen();
    const client = new MachineClient({ serverUrl: url });
    const settled = await client.askUser('step-1', { requestId: 'ask-y', questions: QUESTIONS });
    expect(settled.status).toBe('cancelled');
    expect(settled.reason).toContain('用户取消');
  }, 10_000);

  test('signal is the only exit: abort throws (no infinite wait)', async () => {
    stubAskServer([
      () => ({
        status: 200,
        json: { status: 'pending', requestId: 'ask-z', answers: null, reason: null },
      }),
    ]);
    const url = await listen();
    const client = new MachineClient({ serverUrl: url });
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 150);
    await expect(
      client.askUser(
        'step-1',
        { requestId: 'ask-z', questions: QUESTIONS },
        { signal: abort.signal },
      ),
    ).rejects.toThrow();
  }, 10_000);

  test('server 4xx throws on first occurrence (protocol fact, not retried)', async () => {
    const { bodies } = stubAskServer([() => ({ status: 400, json: { error: 'bad shape' } })]);
    const url = await listen();
    const client = new MachineClient({ serverUrl: url });
    await expect(
      client.askUser('step-1', { requestId: 'ask-bad', questions: QUESTIONS }),
    ).rejects.toThrow('bad shape');
    expect(bodies).toHaveLength(1);
  }, 10_000);
});

describe('#1049 pi ctx.ui → ask channel mapping (#1023 seam)', () => {
  const ask = (params: Record<string, unknown>): Promise<string> => {
    const questions = (params.questions ?? []) as {
      header: string;
      options: { label: string }[];
    }[];
    const q = questions[0];
    if (q === undefined) return Promise.resolve(JSON.stringify({ status: 'cancelled' }));
    if (q.options.length === 0) {
      return Promise.resolve(
        JSON.stringify({
          status: 'answered',
          answers: [{ header: q.header, text: 'free-text-answer' }],
        }),
      );
    }
    return Promise.resolve(
      JSON.stringify({
        status: 'answered',
        answers: [{ header: q.header, choices: [q.options[0]?.label ?? ''] }],
      }),
    );
  };

  test('select → single-choice card → returns the first option', async () => {
    const ui = headlessCaptureUi(() => {}, ask);
    const picked = await ui.select('用哪个分支？', ['main', 'dev']);
    expect(picked).toBe('main');
  });

  test('input → free-text card → returns the text', async () => {
    const ui = headlessCaptureUi(() => {}, ask);
    const text = await ui.input('备注？');
    expect(text).toBe('free-text-answer');
  });

  test('confirm → yes/no options → returns boolean', async () => {
    const ui = headlessCaptureUi(() => {}, ask);
    expect(await ui.confirm('继续吗？', '')).toBe(true);
  });

  test('cancelled → select/input return undefined (pi semantics: no answer)', async () => {
    const ui = headlessCaptureUi(
      () => {},
      () => Promise.resolve(JSON.stringify({ status: 'cancelled', answers: null, reason: 'x' })),
    );
    expect(await ui.select('问', ['a', 'b'])).toBeUndefined();
    expect(await ui.input('问')).toBeUndefined();
    expect(await ui.confirm('问', '')).toBe(false);
  });

  test('absent ask = no-op stub (zero drift for worker steps: select always undefined)', async () => {
    const ui = headlessCaptureUi(() => {});
    expect(await ui.select('问', ['a'])).toBeUndefined();
    expect(await ui.confirm('问', '')).toBeUndefined();
    expect(await ui.input('问')).toBeUndefined();
  });
});

describe('#1049 claude-code carrier surface (buildHostTools relay blocks)', () => {
  test('ask_user tool handler: relay JSON text enters the tool result verbatim', async () => {
    let seenParams: Record<string, unknown> | null = null;
    const tools = buildHostTools({
      remoteTools: [
        {
          name: 'ask_user',
          description: 'Ask the user.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ],
      relay: (name, params) => {
        expect(name).toBe('ask_user');
        seenParams = params;
        return Promise.resolve(
          JSON.stringify({
            status: 'answered',
            requestId: 'ask-t',
            answers: [{ header: 'h', choices: ['a'] }],
            reason: null,
          } satisfies MachineAskResponse),
        );
      },
      localTools: [],
    });
    expect(tools).toHaveLength(1);
    const result = await (
      tools[0] as { handler: (args: unknown, extra: unknown) => Promise<unknown> }
    ).handler(
      {
        questions: QUESTIONS,
      },
      undefined,
    );
    const content = (result as { content: { type: string; text: string }[] }).content[0];
    expect(content?.type).toBe('text');
    expect(JSON.parse(content?.text ?? '{}')).toMatchObject({ status: 'answered' });
    expect(seenParams).toMatchObject({ questions: QUESTIONS });
  });

  test('relay error → isError tool result (model can self-correct), turn continues', async () => {
    const tools = buildHostTools({
      remoteTools: [
        {
          name: 'ask_user',
          description: 'Ask the user.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ],
      relay: () => Promise.reject(new Error('ask channel aborted: stopped')),
      localTools: [],
    });
    const result = await (
      tools[0] as { handler: (args: unknown, extra: unknown) => Promise<unknown> }
    ).handler({}, undefined);
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect((result as { content: { text: string }[] }).content[0]?.text).toContain(
      'ask_user rejected',
    );
  });
});
