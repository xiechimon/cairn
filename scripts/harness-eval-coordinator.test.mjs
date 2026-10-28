import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDbWithHandle } from '../apps/server/src/db/client.ts';
import { EvaluationCoordinator } from '../apps/server/src/services/harness-eval-coordinator.ts';

const request = {
  repo: 'xiechimon/cairn',
  pr: 42,
  ticket: 1977,
  expectedHead: 'a'.repeat(40),
  patchDigest: `pd2:${'b'.repeat(64)}`,
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-eval-coordinator-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  openDbWithHandle(join(root, 'attempts.sqlite')).close();
  let time = 100;
  const launches = [];
  const publicationLog = join(root, 'publications.jsonl');
  const publisher = join(root, 'publisher.mjs');
  writeFileSync(
    publisher,
    `import { appendFileSync, readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(0, 'utf8'));
appendFileSync(process.argv[2], JSON.stringify(input) + '\\n');
console.log(JSON.stringify({ commit: 'c'.repeat(40) }));
`,
  );
  const states = new Map();
  const worker = {
    async dispatch(attempt) {
      launches.push(attempt);
      states.set(attempt.workerId, { state: 'running' });
      return { state: 'accepted' };
    },
    async poll(attempt) {
      return states.get(attempt.workerId) ?? { state: 'unknown' };
    },
    publication: { command: process.execPath, args: [publisher, publicationLog], timeoutMs: 1000 },
  };
  return {
    root,
    open() {
      return new EvaluationCoordinator({
        database: join(root, 'attempts.sqlite'),
        worker,
        now: () => time,
        timeoutMs: 1000,
      });
    },
    worker,
    launches,
    publisher,
    get publications() {
      return existsSync(publicationLog)
        ? readFileSync(publicationLog, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        : [];
    },
    states,
    advance: (value) => {
      time = value;
    },
  };
}

test('concurrent claims, repeated requests and restarts dispatch one worker per digest', async (t) => {
  const f = fixture(t);
  const first = f.open();
  const second = f.open();
  const attempts = await Promise.all(
    Array.from({ length: 12 }, (_, i) => (i % 2 ? first : second).request(request)),
  );
  assert.equal(f.launches.length, 1);
  assert.equal(new Set(attempts.map((a) => a.workerId)).size, 1);
  assert.equal(attempts[0].deadline, 1100);
  const restarted = f.open();
  const repeated = await restarted.request({ ...request, expectedHead: 'd'.repeat(40) });
  assert.equal(repeated.workerId, attempts[0].workerId);
  assert.equal(f.launches.length, 1);
  f.states.set(repeated.workerId, { state: 'complete', result: { score: 1 } });
  assert.equal((await restarted.reconcile(repeated.workerId)).outcome, 'completed');
  assert.equal((await first.reconcile(repeated.workerId)).outcome, 'completed');
  assert.equal(f.publications.length, 1);
});

test('lost dispatch acknowledgment never retries and recovers completion after restart', async (t) => {
  const f = fixture(t);
  f.worker.dispatch = async (attempt) => {
    f.launches.push(attempt);
    f.states.set(attempt.workerId, { state: 'complete', result: { score: 1 } });
    throw new Error('Acknowledgment lost');
  };
  const attempt = await f.open().request(request);
  assert.equal(attempt.state, 'uncertain');
  await f.open().request(request);
  assert.equal(f.launches.length, 1);
  assert.equal((await f.open().reconcile(attempt.workerId)).outcome, 'completed');
});

for (const outcome of ['worker-failed', 'worker-unavailable', 'budget-refused']) {
  test(`${outcome} is durable and requires human attention`, async (t) => {
    const f = fixture(t);
    const attempt = await f.open().request(request);
    f.states.set(attempt.workerId, { state: outcome });
    const result = await f.open().reconcile(attempt.workerId);
    assert.equal(result.outcome, outcome);
    assert.equal(result.requiresHuman, true);
    assert.equal((await f.open().request(request)).outcome, outcome);
    assert.equal(f.launches.length, 1);
    assert.equal(f.publications.length, 0);
  });
}

test('deadline expiry survives restart and rejects late completion', async (t) => {
  const f = fixture(t);
  const attempt = await f.open().request(request);
  f.advance(1100);
  const [expired] = await f.open().reconcileAll();
  assert.equal(expired.outcome, 'timed-out');
  assert.equal(expired.requiresHuman, true);
  f.states.set(attempt.workerId, { state: 'complete', result: { score: 1 } });
  assert.equal((await f.open().reconcile(attempt.workerId)).outcome, 'timed-out');
  assert.equal(f.publications.length, 0);
});

test('new digests supersede old authorization while evidence-only heads reuse attempts', async (t) => {
  const f = fixture(t);
  const old = await f.open().request(request);
  const next = await f.open().request({ ...request, patchDigest: `pd2:${'e'.repeat(64)}` });
  assert.equal(f.launches.length, 2);
  assert.notEqual(old.workerId, next.workerId);
  f.states.set(old.workerId, { state: 'complete', result: { score: 1 } });
  assert.equal((await f.open().reconcile(old.workerId)).outcome, 'superseded');
  assert.equal(f.publications.length, 0);
  assert.equal((await f.open().request(request)).outcome, 'superseded');
  assert.equal(f.launches.length, 2);
});

test('publication rejection is terminal and cannot be retried', async (t) => {
  const f = fixture(t);
  const attempt = await f.open().request(request);
  f.states.set(attempt.workerId, { state: 'complete', result: { score: 1 } });
  writeFileSync(f.publisher, 'process.exit(1);');
  assert.equal((await f.open().reconcile(attempt.workerId)).outcome, 'publication-rejected');
  assert.equal((await f.open().reconcile(attempt.workerId)).requiresHuman, true);
  assert.equal(f.publications.length, 0);
});

test('deadline and supersession are rechecked after an in-flight poll', async (t) => {
  const f = fixture(t);
  const attempt = await f.open().request(request);
  f.worker.poll = async () => {
    f.advance(1100);
    return { state: 'complete', result: { score: 1 } };
  };
  assert.equal((await f.open().reconcile(attempt.workerId)).outcome, 'timed-out');
  assert.equal(f.publications.length, 0);
});

test('poll failures and unknown dispatches eventually time out without another paid run', async (t) => {
  const f = fixture(t);
  f.worker.dispatch = async (attempt) => {
    f.launches.push(attempt);
    throw new Error('Disconnected');
  };
  const attempt = await f.open().request(request);
  f.worker.poll = async () => {
    throw new Error('Disconnected');
  };
  assert.equal((await f.open().reconcile(attempt.workerId)).state, 'uncertain');
  f.advance(1100);
  assert.equal((await f.open().reconcile(attempt.workerId)).outcome, 'timed-out');
  assert.equal(f.launches.length, 1);
});

function childFixture(t) {
  const f = fixture(t);
  const script = join(f.root, 'child.mjs');
  const database = join(f.root, 'attempts.sqlite');
  const log = join(f.root, 'launches.jsonl');
  writeFileSync(
    script,
    String.raw`
import { appendFileSync } from 'node:fs';
import { EvaluationCoordinator } from ${JSON.stringify(new URL('../apps/server/src/services/harness-eval-coordinator.ts', import.meta.url).href)};
const worker = {
  async dispatch(attempt) {
    appendFileSync(process.argv[3], JSON.stringify(attempt) + '\n');
    if (process.argv[4] === 'claim-crash') process.exit(73);
    return { state: 'accepted' };
  },
  async poll() { return { state: 'complete', result: { score: 1 } }; },
  publication: { command: process.execPath, args: ['-e', 'console.log(JSON.stringify({ commit: "c".repeat(40) }))'], timeoutMs: 1000 },
};
const coordinator = new EvaluationCoordinator({ database: process.argv[2], worker, timeoutMs: 1000, now: () => 100 });
if (process.argv[4] === 'publish-crash') {
  const transaction = coordinator.transaction.bind(coordinator);
  coordinator.transaction = (action) => {
    const result = transaction(action);
    if (result?.publish) process.exit(74);
    return result;
  };
}
const attempt = await coordinator.request(${JSON.stringify(request)});
if (process.argv[4] === 'publish-crash') await coordinator.reconcile(attempt.workerId);
`,
  );
  return {
    ...f,
    script,
    database,
    log,
    get publications() {
      return f.publications;
    },
  };
}

test('independent processes atomically claim one durable attempt', async (t) => {
  const f = childFixture(t);
  await Promise.all(
    Array.from(
      { length: 8 },
      () =>
        new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              '--import',
              new URL('../apps/server/node_modules/tsx/dist/loader.mjs', import.meta.url).href,
              f.script,
              f.database,
              f.log,
              'normal',
            ],
            {
              stdio: 'pipe',
            },
          );
          let stderr = '';
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.on('error', reject);
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
        }),
    ),
  );
  const launches = readFileSync(f.log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(launches.length, 1);
  assert.equal(launches[0].deadline, 1100);
  await f.open().request(request);
  assert.equal(f.launches.length, 0);
});

for (const [mode, code, expected] of [
  ['claim-crash', 73, 'completed'],
  ['publish-crash', 74, 'publication-uncertain'],
]) {
  test(`process death during ${mode} never repeats dispatch or publication`, async (t) => {
    const f = childFixture(t);
    assert.throws(
      () =>
        execFileSync(process.execPath, [
          '--import',
          new URL('../apps/server/node_modules/tsx/dist/loader.mjs', import.meta.url).href,
          f.script,
          f.database,
          f.log,
          mode,
        ]),
      (error) => error.status === code,
    );
    const [attempt] = readFileSync(f.log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    f.states.set(attempt.workerId, { state: 'complete', result: { score: 1 } });
    await f.open().request(request);
    await f.open().request({ ...request, expectedHead: 'd'.repeat(40) });
    assert.equal(readFileSync(f.log, 'utf8').trim().split('\n').length, 1);
    assert.equal(f.launches.length, 0);
    const recovered = await f.open().reconcile(attempt.workerId);
    assert.equal(recovered.outcome, expected);
    assert.equal(f.launches.length, 0);
    assert.equal(f.publications.length, mode === 'claim-crash' ? 1 : 0);
    assert.equal((await f.open().request(request)).outcome, expected);
  });
}

test('attempt storage must survive reopening and deadlines must be representable', async (t) => {
  const f = fixture(t);
  for (const database of [':memory:', '', 'attempts.sqlite']) {
    assert.throws(
      () => new EvaluationCoordinator({ database, worker: f.worker, timeoutMs: 1000 }),
      /persistent absolute database path/,
    );
  }
  for (const time of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) {
    f.advance(time);
    await assert.rejects(f.open().request(request), /Invalid evaluation deadline/);
  }
  assert.equal(f.launches.length, 0);
  f.advance(100);
  assert.equal((await f.open().request(request)).deadline, 1100);
});

test('repeated running polls retain the original deadline and dispatch identity', async (t) => {
  const f = fixture(t);
  const attempt = await f.open().request(request);
  for (const time of [200, 500, 1099]) {
    f.advance(time);
    const record = await f.open().reconcile(attempt.workerId);
    assert.equal(record.state, 'running');
    assert.equal(record.deadline, 1100);
  }
  f.advance(1100);
  assert.equal((await f.open().reconcile(attempt.workerId)).outcome, 'timed-out');
  assert.equal(f.launches.length, 1);
});

for (const outcome of ['worker-failed', 'worker-unavailable', 'budget-refused']) {
  test(`dispatch ${outcome} is terminal before polling`, async (t) => {
    const f = fixture(t);
    f.worker.dispatch = async (attempt) => {
      f.launches.push(attempt);
      return { state: outcome };
    };
    const attempt = await f.open().request(request);
    assert.equal(attempt.outcome, outcome);
    assert.equal(attempt.requiresHuman, true);
    assert.equal((await f.open().request(request)).outcome, outcome);
    assert.equal(f.launches.length, 1);
  });
}

test('supersession during dispatch revokes late acknowledgment and completion', async (t) => {
  const f = fixture(t);
  let acknowledge;
  f.worker.dispatch = (attempt) => {
    f.launches.push(attempt);
    return new Promise((resolve) => {
      acknowledge = resolve;
    });
  };
  const pending = f.open().request(request);
  const [attempt] = f.launches;
  f.worker.dispatch = async () => ({ state: 'accepted' });
  await f.open().request({ ...request, patchDigest: `pd2:${'f'.repeat(64)}` });
  acknowledge({ state: 'accepted' });
  assert.equal((await pending).outcome, 'superseded');
  f.states.set(attempt.workerId, { state: 'complete', result: { score: 1 } });
  assert.equal((await f.open().reconcile(attempt.workerId)).outcome, 'superseded');
  assert.equal(f.publications.length, 0);
});

test('deadline passing during dispatch grants a fresh window on late acceptance', async (t) => {
  const f = fixture(t);
  let acknowledge;
  f.worker.dispatch = (attempt) => {
    f.launches.push(attempt);
    return new Promise((resolve) => {
      acknowledge = resolve;
    });
  };
  const pending = f.open().request(request);
  const [attempt] = f.launches;
  f.advance(1100);
  acknowledge({ state: 'accepted' });
  const accepted = await pending;
  assert.equal(accepted.state, 'running');
  assert.equal(accepted.deadline, 2100);
  f.states.set(attempt.workerId, { state: 'complete', result: { score: 1 } });
  assert.equal((await f.open().reconcile(attempt.workerId)).outcome, 'completed');
  assert.equal(f.publications.length, 1);
});

test('a hanging dispatch port does not consume the superseding attempt budget', async (t) => {
  const f = fixture(t);
  const acks = [];
  f.worker.dispatch = (attempt) => {
    f.launches.push(attempt);
    return new Promise((resolve) => {
      acks.push(resolve);
    });
  };
  const old = f.open().request(request);
  const next = f.open().request({ ...request, patchDigest: `pd2:${'e'.repeat(64)}` });
  assert.equal(f.launches.length, 2);
  f.advance(1100);
  acks[1]({ state: 'accepted' });
  const nextAttempt = await next;
  assert.equal(nextAttempt.state, 'running');
  assert.equal(nextAttempt.deadline, 2100);
  acks[0]({ state: 'accepted' });
  assert.equal((await old).outcome, 'superseded');
  f.states.set(nextAttempt.workerId, { state: 'complete', result: { score: 1 } });
  assert.equal((await f.open().reconcile(nextAttempt.workerId)).outcome, 'completed');
  assert.equal(f.publications.length, 1);
  assert.equal((await f.open().request(request)).outcome, 'superseded');
  assert.equal(f.launches.length, 2);
});

test('a process killed after durable claim and before dispatch never launches on restart', async (t) => {
  const f = childFixture(t);
  const source = readFileSync(f.script, 'utf8');
  writeFileSync(
    f.script,
    source.replace(
      'const attempt = await coordinator.request(',
      `
const transaction = coordinator.transaction.bind(coordinator);
coordinator.transaction = (action) => {
  const result = transaction(action);
  if (result?.created) process.exit(75);
  return result;
};
const attempt = await coordinator.request(`,
    ),
  );
  assert.throws(
    () =>
      execFileSync(process.execPath, [
        '--import',
        new URL('../apps/server/node_modules/tsx/dist/loader.mjs', import.meta.url).href,
        f.script,
        f.database,
        f.log,
        'normal',
      ]),
    (error) => error.status === 75,
  );
  const restarted = f.open();
  const attempt = await restarted.request(request);
  assert.equal(attempt.state, 'uncertain');
  assert.equal(existsSync(f.log), false);
  await f.open().request({ ...request, expectedHead: 'd'.repeat(40) });
  assert.equal(f.launches.length, 0);
  f.advance(attempt.deadline);
  assert.equal((await f.open().reconcile(attempt.workerId)).outcome, 'timed-out');
  assert.equal((await f.open().request(request)).outcome, 'timed-out');
  assert.equal(f.launches.length, 0);
});

test('ordinary Promise-returning publishers cannot enter the publication boundary', async (t) => {
  const f = fixture(t);
  let calls = 0;
  f.worker.publish = () => {
    calls += 1;
    return Promise.resolve({ commit: 'c'.repeat(40) });
  };
  assert.throws(() => f.open(), /publication command/);
  assert.equal(calls, 0);
});

test('completion authenticates worker identity and fences late callbacks', async (t) => {
  const f = fixture(t);
  const coordinator = f.open();
  const attempt = await coordinator.request(request);
  await assert.rejects(
    coordinator.complete(attempt.id, 'wrong-worker', { state: 'complete', result: {} }),
    /Worker identity/,
  );
  assert.equal(f.publications.length, 0);
  const result = await coordinator.complete(attempt.id, attempt.workerId, {
    state: 'complete',
    result: { score: 1 },
  });
  assert.equal(result.outcome, 'completed');
  assert.equal(
    (await f.open().complete(attempt.id, attempt.workerId, { state: 'complete', result: {} }))
      .outcome,
    'completed',
  );
  assert.equal(f.publications.length, 1);
});

for (const revoke of ['deadline', 'supersession']) {
  test(`direct completion rejects ${revoke} after a restart`, async (t) => {
    const f = fixture(t);
    const attempt = await f.open().request(request);
    if (revoke === 'deadline') f.advance(attempt.deadline);
    else await f.open().request({ ...request, patchDigest: `pd2:${'e'.repeat(64)}` });
    const result = await f
      .open()
      .complete(attempt.id, attempt.workerId, { state: 'complete', result: {} });
    assert.equal(result.outcome, revoke === 'deadline' ? 'timed-out' : 'superseded');
    assert.equal(f.publications.length, 0);
  });
}

test('publication waits for command completion and rejects commands that exceed their deadline', async (t) => {
  const f = fixture(t);
  f.worker.publication.timeoutMs = 20;
  writeFileSync(
    f.publisher,
    `setTimeout(() => console.log(JSON.stringify({ commit: 'c'.repeat(40) })), 10000);`,
  );
  const attempt = await f.open().request(request);
  const result = await f
    .open()
    .complete(attempt.id, attempt.workerId, { state: 'complete', result: {} });
  assert.equal(result.outcome, 'publication-rejected');
  assert.equal(result.requiresHuman, true);
  assert.equal((await f.open().request(request)).outcome, 'publication-rejected');
});
