// #1049 问答通道 daemon 半边（unit）：
// ① machine-client askUser 循环——pending 重发（同 requestId 幂等）、答毕
//    resolve、5xx 瞬断不终结等待、signal 是唯一退出面；
// ② pi headlessCaptureUi 的 ctx.ui 三原语（select/confirm/input）→ ask 通道
//    映射（#1023 的缝：接上即原生问答）；
// ③ claude-code 后端承载面（buildHostTools 的 ask_user handler 走 relay ——
//    in-process MCP 工具调用阻塞由 SDK 无超时契约承载，真实 75s 往返见
//    docs/verify/1049 探针证据）。
// 全链（pi 会话阻塞 → 同回合续）归 integration chief-ask-user.test.ts。

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

/** 桩 ask 端点：脚本化响应序列；记录收到的 body（幂等键断言用）。 */
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

describe('#1049 machine-client askUser 循环', () => {
  test('pending 重发同 requestId（D4 幂等）→ answered 即 resolve', async () => {
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
    // 幂等：三次 POST 全部同 requestId。
    expect(bodies.map((b) => b.requestId)).toEqual(['ask-x', 'ask-x', 'ask-x']);
  }, 10_000);

  test('5xx 瞬断不终结等待（重试后拿到答案）', async () => {
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

  test('signal 是唯一退出面：abort 即抛（不无限等）', async () => {
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

  test('server 4xx 单次即抛（协议事实不重试）', async () => {
    const { bodies } = stubAskServer([() => ({ status: 400, json: { error: 'bad shape' } })]);
    const url = await listen();
    const client = new MachineClient({ serverUrl: url });
    await expect(
      client.askUser('step-1', { requestId: 'ask-bad', questions: QUESTIONS }),
    ).rejects.toThrow('bad shape');
    expect(bodies).toHaveLength(1);
  }, 10_000);
});

describe('#1049 pi ctx.ui → ask 通道映射（#1023 缝）', () => {
  const ask = (params: Record<string, unknown>): Promise<string> => {
    // 桩通道：单题往返（select → 第一个 choice；input → text）。
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

  test('select → 单选题卡 → 返回首个选项', async () => {
    const ui = headlessCaptureUi(() => {}, ask);
    const picked = await ui.select('用哪个分支？', ['main', 'dev']);
    expect(picked).toBe('main');
  });

  test('input → 自由文本题卡 → 返回文本', async () => {
    const ui = headlessCaptureUi(() => {}, ask);
    const text = await ui.input('备注？');
    expect(text).toBe('free-text-answer');
  });

  test('confirm → 是/否两选项 → 返回布尔', async () => {
    const ui = headlessCaptureUi(() => {}, ask);
    expect(await ui.confirm('继续吗？', '')).toBe(true);
  });

  test('cancelled → select/input 返回 undefined（pi 语义：没答）', async () => {
    const ui = headlessCaptureUi(
      () => {},
      () => Promise.resolve(JSON.stringify({ status: 'cancelled', answers: null, reason: 'x' })),
    );
    expect(await ui.select('问', ['a', 'b'])).toBeUndefined();
    expect(await ui.input('问')).toBeUndefined();
    expect(await ui.confirm('问', '')).toBe(false);
  });

  test('ask 缺席 = no-op 桩（worker 步零漂移：select 恒 undefined）', async () => {
    const ui = headlessCaptureUi(() => {});
    expect(await ui.select('问', ['a'])).toBeUndefined();
    expect(await ui.confirm('问', '')).toBeUndefined();
    expect(await ui.input('问')).toBeUndefined();
  });
});

describe('#1049 claude-code 承载面（buildHostTools relay 阻塞）', () => {
  test('ask_user 工具 handler：relay 返回的 JSON 文本原样进工具结果', async () => {
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

  test('relay 抛错 → isError 工具结果（模型可自纠），回合不断', async () => {
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
