import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(new URL('../../../integration/package.json', import.meta.url));
const loader = require.resolve('tsx/cli');
const out = resolve(process.argv[2]);
const flow = mkdtempSync(join(tmpdir(), 'cairn-retry-proof-'));
const dataset = JSON.parse(readFileSync('.claude/hillclimb/chief-dispatch/cases.json', 'utf8'));
const hold = dataset.cases.find((entry) => entry.expect.kind === 'hold');
assert.ok(hold);
writeFileSync(
  join(flow, 'cases.json'),
  JSON.stringify({ roster: dataset.roster, cases: [{ ...hold, id: 'probe01' }] }),
);
let calls = 0;
const statuses = [];
const relay = createServer(async (request, response) => {
  for await (const _chunk of request) {
  }
  calls += 1;
  if (calls === 1) {
    statuses.push(400);
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: { message: 'Controlled permanent request rejection', type: 'invalid_request_error' },
      }),
    );
    return;
  }
  statuses.push(200);
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(
    [
      'data: ' +
        JSON.stringify({
          id: 'probe',
          model: 'glm-5.3',
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'No active tasks.' },
              finish_reason: null,
            },
          ],
        }),
      '',
      'data: ' +
        JSON.stringify({
          id: 'probe',
          model: 'glm-5.3',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      '',
      'data: [DONE]',
      '',
    ].join('\n'),
  );
});
await new Promise((resolveListen) => relay.listen(0, '127.0.0.1', resolveListen));
const address = relay.address();
assert.ok(address && typeof address === 'object');
try {
  const child = spawn(
    process.execPath,
    [
      loader,
      'integration/eval/chief-dispatch/run-eval.mts',
      '--flow',
      flow,
      '--variant',
      'baseline',
      '--model',
      'glm-5.3',
      '--reps',
      '1',
      '--concurrency',
      '1',
      '--timeout-s',
      '120',
      '--approve-harness',
    ],
    {
      env: {
        ...process.env,
        CAIRN_EVAL_RELAY_URL: `http://127.0.0.1:${address.port}/v1`,
        CAIRN_EVAL_RELAY_KEY: 'nonsecret-local-probe',
        TMPDIR: '/private/tmp',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const rc = await new Promise((resolveExit) => child.on('close', resolveExit));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'runner.log'), output);
  assert.equal(rc, 0, output.slice(-1500));
  const rows = readFileSync(join(flow, 'baseline', 'results.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].meta?.infra_retries, 1);
  assert.equal(rows[0].grade?.decision_ok, 1);
  assert.deepEqual(statuses, [400, 200]);
  const proof = {
    providerMode: 'local stub',
    runtime: 'real server, daemon, and eval CLI',
    requestStatuses: statuses,
    resultRows: rows.length,
    infraRetries: rows[0].meta.infra_retries,
    decisionOk: rows[0].grade.decision_ok,
  };
  writeFileSync(join(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
} finally {
  await new Promise((resolveClose) => relay.close(resolveClose));
  rmSync(flow, { recursive: true, force: true });
}
