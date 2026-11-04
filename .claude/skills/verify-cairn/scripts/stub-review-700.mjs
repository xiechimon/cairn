import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 8921);
const REPLAN_DELAY_MS = 30_000;

const VERDICT_JSON = JSON.stringify(
  {
    conclusion: '方案在边界情况上存在硬风险，需修复两处',
    findings: [
      {
        id: '1',
        severity: 'blocking',
        summary: '未处理空输入',
        description: 'parseInput 对空字符串未做防御',
        file: 'src/parse.ts',
        line: 42,
        suggestion: '加入空字符串 early return',
      },
      {
        id: '2',
        severity: 'blocking',
        summary: 'JSON 反序列化未捕获异常',
        description: '解析远端返回时若格式异常会冒泡到上层',
        file: 'src/parse.ts',
        line: 67,
        suggestion: 'try/catch 包 JSON.parse 并返回空对象',
      },
      { id: '3', severity: 'suggestion', summary: '日志格式可统一' },
    ],
  },
  null,
  2,
);

function chunk(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (d) => {
    body += d;
  });
  req.on('end', () => {
    const scenarioB = body.includes('EXTRACT-FAIL-MARKER');

    const isReplanRound = body.includes('请重新规划该任务');

    let hasToolResult = false;
    try {
      hasToolResult = (JSON.parse(body).messages ?? []).some((m) => m.role === 'tool');
    } catch {
      hasToolResult = false;
    }
    const isFollowUp = hasToolResult && !isReplanRound;

    const respond = () => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const base = {
        id: 'chatcmpl-stub-700',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'stub-model',
      };
      res.write(
        chunk({
          ...base,
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        }),
      );
      if (scenarioB || isReplanRound) {
        for (const word of '看完了，方案整体可行，没有发现需要修订的问题。'.split(/(?<=。)/u)) {
          if (word === '') continue;
          res.write(chunk({ ...base, choices: [{ index: 0, delta: { content: word } }] }));
        }
        res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
      } else if (isFollowUp) {
        res.write(
          chunk({
            ...base,
            choices: [{ index: 0, delta: { content: '任务标题已回填，审核结论如上。' } }],
          }),
        );
        res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
      } else {

        res.write(chunk({ ...base, choices: [{ index: 0, delta: { content: VERDICT_JSON } }] }));
        res.write(
          chunk({
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-set-meta-700',
                      type: 'function',
                      function: { name: 'set_task_meta', arguments: '' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
        );
        res.write(
          chunk({
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: { arguments: JSON.stringify({ title: '审核探针改题' }) },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
        );
        res.write(
          chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
        );
      }
      res.write(
        chunk({
          ...base,
          choices: [],
          usage: { prompt_tokens: 40, completion_tokens: 120, total_tokens: 160 },
        }),
      );
      res.write('data: [DONE]\n\n');
      res.end();
      process.stdout.write(
        `[stub-review-700] ${new Date().toISOString()} round=${
          scenarioB
            ? 'B-prose'
            : isReplanRound
              ? 'A-replan(delayed)'
              : isFollowUp
                ? 'A-followup'
                : 'A-verdict+toolcall'
        }\n`,
      );
    };
    if (isReplanRound && !scenarioB) setTimeout(respond, REPLAN_DELAY_MS);
    else respond();
  });
});
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`stub-review-700 listening on ${PORT}\n`);
});
