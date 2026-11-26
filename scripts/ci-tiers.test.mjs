import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { prepushModules } from './prepush.mjs';
import { scrubGateEnv } from './scrub-git-env.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const jobs = new Map(
  workflow
    .split('\njobs:\n')[1]
    .split(/\n(?= {2}[a-z][\w-]*:)/)
    .map((job) => [job.match(/^ {2}([\w-]+):/)[1], job]),
);

function job(name) {
  const block = jobs.get(name);
  assert.ok(block, `ci.yml has no job ${name}`);
  return block;
}

const TOKEN = /\s+|'(?:[^']|'')*'|==|!=|&&|\|\||[!(),]|[A-Za-z_][\w.-]*/y;

function evaluate(expression, context) {
  const source = expression.replace(/^\$\{\{ (.*) \}\}$/, '$1');
  let js = '';
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(source);
    assert.ok(match, `cannot read ${JSON.stringify(source.slice(at))}`);
    const token = match[0];
    if (/^\s+$/.test(token)) js += ' ';
    else if (token.startsWith("'")) js += JSON.stringify(token.slice(1, -1).replaceAll("''", "'"));
    else if (token === '==' || token === '!=') js += `${token}=`;
    else if (['&&', '||', '!', '(', ')', ','].includes(token)) js += token;
    else if (token === 'startsWith') js += 'startsWith';
    else if (token === 'cancelled') js += 'cancelled';
    else if (token === 'true' || token === 'false' || token === 'null') js += token;
    else {
      assert.ok(token in context, `the scenario does not define ${token}`);
      js += JSON.stringify(context[token]);
    }
  }
  const startsWith = (value, prefix) =>
    String(value ?? '')
      .toLowerCase()
      .startsWith(String(prefix).toLowerCase());
  const cancelled = () => context['job.cancelled'] === true;
  return new Function('startsWith', 'cancelled', `return (${js});`)(startsWith, cancelled);
}

const condition = (name) => job(name).match(/^ {4}if: (.*)$/m)?.[1];
const tierExpression = job('changes').match(/^ {6}e2e-tier: (.*)$/m)?.[1];

function githubContext({ event, draft = null, login = null, head = '', reusedSha = 'false' }) {
  return {
    'github.event_name': event,
    'github.event.pull_request.draft': draft,
    'github.event.pull_request.user.login': login,
    'github.head_ref': head,
    'needs.changes.outputs.reused-sha': reusedSha,
  };
}

const events = {
  'ordinary PR': githubContext({
    event: 'pull_request',
    draft: false,
    login: 'xiechimon',
    head: 'C1/ci-tiers',
  }),
  'draft PR by a person': githubContext({
    event: 'pull_request',
    draft: true,
    login: 'xiechimon',
    head: 'C1/ci-tiers',
  }),
  'push to main': githubContext({ event: 'push' }),
};

function plan(github, hasCode, e2eTier = 'none') {
  const changes = { 'needs.changes.outputs.has-code': hasCode };
  changes['needs.changes.outputs.e2e-tier'] = evaluate(tierExpression, {
    ...github,
    'steps.classify.outputs.e2e-tier': e2eTier,
  });
  const context = { ...github, ...changes };
  return {
    tier: changes['needs.changes.outputs.e2e-tier'],
    e2e: evaluate(condition('e2e'), context),
    'e2e-affected': evaluate(condition('e2e-affected'), context),
  };
}

function gateShell({ results, outputs }) {
  const command = job('e2e-gate')
    .match(/run: \|\n([\s\S]*)/)[1]
    .replace(/^ {10}/gm, '');
  return command.replace(/\$\{\{ (.*?) \}\}/g, (_, expression) => {
    const output = /^needs\.changes\.outputs\.([\w-]+)$/.exec(expression);
    if (output) {
      if (output[1] === 'reused-sha' && !(output[1] in outputs)) return 'false';
      assert.ok(output[1] in outputs, expression);
      return outputs[output[1]];
    }
    const result = /^needs\.([\w-]+)\.result$/.exec(expression);
    assert.ok(result && result[1] in results, expression);
    return results[result[1]];
  });
}

function gatePasses(scenarios) {
  const script = scenarios
    .map(
      (scenario) =>
        `(\nset -e -o pipefail\nGITHUB_REF=${JSON.stringify(scenario.githubRef ?? 'refs/heads/main')}\n${gateShell(scenario)}\n) >/dev/null 2>&1; echo $?`,
    )
    .join('\n');
  const run = spawnSync('bash', ['-s'], {
    input: script,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  const statuses = run.stdout.trim().split('\n');
  assert.equal(statuses.length, scenarios.length);
  return statuses.map((status) => status === '0');
}

test('the full 6-shard e2e and 4-shard e2e-affected match classifier tiers unless draft overrides', () => {
  assert.ok(tierExpression);
  assert.match(job('e2e'), /shard: \[1, 2, 3, 4, 5, 6\]/);
  assert.match(job('e2e'), /run: pnpm prepush --e2e-shard \$\{\{ matrix.shard \}\}\/6/);
  assert.match(job('e2e-affected'), /shard: \[1, 2, 3, 4\]/);
  assert.match(job('e2e-affected'), /run: pnpm --filter @cairn\/web e2e:affected --shard=/);
  assert.match(job('e2e-affected'), /fetch-depth: 0/);
  assert.match(
    job('e2e-affected'),
    /PREPUSH_BASE_SHA: \$\{\{ needs\.changes\.outputs\.base-sha \|\| github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}/,
  );
  assert.doesNotMatch(job('e2e-affected'), /prepush --e2e-shard/);
  for (const [name, github] of Object.entries(events)) {
    const isDraft = name === 'draft PR by a person';
    for (const classified of ['none', 'affected', 'full']) {
      const { tier, e2e, 'e2e-affected': affected } = plan(github, 'true', classified);
      const expected = isDraft ? 'none' : classified;
      assert.equal(tier, expected, `${name}: ${classified}`);
      assert.equal(e2e, expected === 'full', `${name}: e2e (${classified})`);
      assert.equal(affected, expected === 'affected', `${name}: e2e-affected (${classified})`);
    }
  }
});

test('no e2e tier runs when the classifier found nothing left to test', () => {
  for (const [name, github] of Object.entries(events)) {
    for (const classified of ['none', 'affected', 'full']) {
      const { e2e, 'e2e-affected': affected } = plan(github, 'false', classified);
      assert.equal(e2e, false, `${name}: e2e (${classified})`);
      assert.equal(affected, false, `${name}: e2e-affected (${classified})`);
    }
  }
});

function expectedGate(tier, hasCode, e2e, affected) {
  if (tier === 'none') return e2e === 'skipped' && affected === 'skipped';
  if (tier !== 'full' && tier !== 'affected') return false;
  const ran = tier === 'full' ? e2e : affected;
  const idle = tier === 'full' ? affected : e2e;
  return idle === 'skipped' && (ran === 'success' || (hasCode === 'false' && ran === 'skipped'));
}

test('e2e-gate passes only when the tier it picked ran and succeeded', () => {
  assert.match(job('e2e-gate'), /^ {4}needs: \[changes, e2e, e2e-affected\]$/m);
  assert.match(job('e2e-gate'), /^ {4}if: always\(\)$/m);
  assert.doesNotMatch(job('e2e-gate'), /uses:|checkout|continue-on-error/);
  const outcomes = ['success', 'failure', 'cancelled'];
  const scenarios = [];
  for (const [name, github] of Object.entries(events))
    for (const [hasCode, classified] of [
      ['true', 'none'],
      ['true', 'affected'],
      ['true', 'full'],
      ['false', 'none'],
    ]) {
      const ran = plan(github, hasCode, classified);
      for (const e2e of ran.e2e ? outcomes : ['skipped'])
        for (const affected of ran['e2e-affected'] ? outcomes : ['skipped'])
          scenarios.push({
            name,
            results: { changes: 'success', e2e, 'e2e-affected': affected },
            outputs: { 'has-code': hasCode, 'e2e-tier': ran.tier },
            expected: expectedGate(ran.tier, hasCode, e2e, affected),
          });
    }
  gatePasses(scenarios).forEach((passed, index) => {
    const { name, results, outputs, expected } = scenarios[index];
    assert.equal(passed, expected, `${name} ${JSON.stringify({ ...results, ...outputs })}`);
  });
});

test('e2e-gate never turns a failed, cancelled or wrong-tier input into a pass', () => {
  const values = ['success', 'skipped', 'failure', 'cancelled'];
  const scenarios = [];
  for (const tier of ['full', 'affected', ''])
    for (const hasCode of ['true', 'false', ''])
      for (const changes of values)
        for (const e2e of values)
          for (const affected of values)
            scenarios.push({
              results: { changes, e2e, 'e2e-affected': affected },
              outputs: { 'has-code': hasCode, 'e2e-tier': tier },
            });
  const passes = gatePasses(scenarios);
  assert.ok(passes.some(Boolean));
  passes.forEach((passed, index) => {
    if (!passed) return;
    const { results, outputs } = scenarios[index];
    const label = JSON.stringify({ ...results, ...outputs });
    assert.equal(results.changes, 'success', label);
    assert.equal(
      expectedGate(outputs['e2e-tier'], outputs['has-code'], results.e2e, results['e2e-affected']),
      true,
      label,
    );
  });
});

test('both e2e tiers run the CSS mechanism gate after a fixture build', () => {
  for (const name of ['e2e', 'e2e-affected']) {
    const block = job(name);
    const gate = block.indexOf('run: node scripts/css-mechanism-gate.mjs');
    assert.notEqual(gate, -1, `${name} runs the CSS mechanism gate`);
    const build =
      name === 'e2e'
        ? block.indexOf('pnpm prepush --e2e-shard')
        : block.indexOf('vite build --mode fixture');
    assert.ok(build !== -1 && build < gate, `${name} builds the fixture before the gate`);
  }
});

test('gates runs only when gates-needed is not false and not cancelled', () => {
  assert.match(job('gates'), /^ {4}needs: changes$/m);
  assert.match(
    job('changes'),
    /^ {6}gates-needed: \$\{\{ steps\.classify\.outputs\.gates-needed \}\}$/m,
  );
  for (const [name, github] of Object.entries(events))
    for (const result of ['success', 'failure', 'skipped'])
      for (const needed of ['true', 'false', ''])
        for (const cancelled of [false, true]) {
          const runs = evaluate(condition('gates'), {
            ...github,
            'job.cancelled': cancelled,
            'needs.changes.result': result,
            'needs.changes.outputs.gates-needed': needed,
          });
          assert.equal(
            runs,
            !cancelled && needed !== 'false',
            `${name}: ${JSON.stringify({ result, needed, cancelled })}`,
          );
        }
});

test('eval waits for check-core so a red typecheck or lint stops before the 30-minute eval', () => {
  assert.match(job('eval'), /^ {4}needs: \[changes, check-core\]$/m);
});

test('reused-sha on main push skips heavy jobs and satisfies e2e-gate only on refs/heads/main', () => {
  const mainCtx = githubContext({ event: 'push', reusedSha: 'true' });
  assert.equal(
    evaluate(condition('e2e'), {
      ...mainCtx,
      'needs.changes.outputs.has-code': 'true',
      'needs.changes.outputs.e2e-tier': 'full',
    }),
    false,
  );
  assert.equal(
    evaluate(condition('e2e-affected'), {
      ...mainCtx,
      'needs.changes.outputs.has-code': 'true',
      'needs.changes.outputs.e2e-tier': 'affected',
    }),
    false,
  );
  assert.equal(
    evaluate(condition('gates'), {
      ...mainCtx,
      'job.cancelled': false,
      'needs.changes.outputs.gates-needed': 'true',
    }),
    false,
  );
  const [okMain, okFeature] = gatePasses(
    [
      {
        results: { changes: 'success', e2e: 'skipped', 'e2e-affected': 'skipped' },
        outputs: { 'has-code': 'true', 'e2e-tier': 'full', 'reused-sha': 'true' },
      },
      {
        results: { changes: 'success', e2e: 'skipped', 'e2e-affected': 'skipped' },
        outputs: { 'has-code': 'true', 'e2e-tier': 'full', 'reused-sha': 'true' },
      },
    ].map((s, idx) => ({ ...s, githubRef: idx === 0 ? 'refs/heads/main' : 'refs/heads/feature' })),
  );
  assert.equal(okMain, true);
  assert.equal(okFeature, false);
});

test('a queue/try run that reused a same-tree verdict satisfies both required aggregates', () => {
  const reused = {
    outputs: { 'has-code': 'true', 'e2e-tier': 'full', 'reused-sha': 'true' },
    results: { changes: 'success', e2e: 'skipped', 'e2e-affected': 'skipped' },
  };
  const verdicts = gatePasses(
    ['refs/heads/queue/try/1-a', 'refs/heads/preflight/host/lane', 'refs/heads/queue/main'].map(
      (githubRef) => ({ ...reused, githubRef }),
    ),
  );
  assert.deepEqual(verdicts, [true, false, false]);

  const aggregate = job('check').match(/run: \|\n([\s\S]*)/)[1];
  const script = (ref) =>
    aggregate
      .replace(/^ {10}/gm, '')
      .replaceAll('${{ needs.changes.result }}', 'success')
      .replaceAll('${{ needs.changes.outputs.reused-sha }}', 'true')
      .replaceAll('${{ needs.changes.outputs.reused-run-id }}', '42')
      .replaceAll('${{ github.event_name }}', 'push')
      .replace(/\$\{\{[^}]*\}\}/g, 'skipped')
      .replace(/^/, `set -e\nGITHUB_REF=${ref}\n`);
  const passes = (ref) => spawnSync('bash', ['-c', script(ref)]).status === 0;
  assert.equal(passes('refs/heads/queue/try/1-a'), true);
  assert.equal(passes('refs/heads/main'), true);
  assert.equal(passes('refs/heads/preflight/host/lane'), false);
});

test('every classify step output is re-exported as a changes job output', () => {
  const block = job('changes');
  const exposed = new Set(
    [...block.matchAll(/^ {6}[\w-]+: \$\{\{.*steps\.classify\.outputs\.([\w-]+).*$/gm)].map(
      (match) => match[1],
    ),
  );
  const emitted = new Set(
    [...block.matchAll(/echo "([\w-]+)=.*" >> "\$GITHUB_OUTPUT"/g)].map((match) => match[1]),
  );
  assert.ok(emitted.size > 0, 'the classify step emits no outputs');
  for (const name of emitted)
    assert.ok(exposed.has(name), `classify emits ${name} but changes.outputs drops it`);
});

test('changes classify script sets outputs across push and pull_request diffs in a real git repo', () => {
  const classifyScript = job('changes')
    .match(/id: classify[\s\S]*?run: \|\n([\s\S]*?)(?=\n {6}- name:|$)/)[1]
    .replace(/^ {10}/gm, '');
  const outer = makeTestTempDir('ci-tiers-classify-');
  const repo = join(outer, 'repo');
  const outputFile = join(outer, 'github-output');
  try {
    mkdirSync(repo, { recursive: true });
    for (const rel of prepushModules) {
      mkdirSync(dirname(join(repo, rel)), { recursive: true });
      copyFileSync(rel, join(repo, rel));
    }
    mkdirSync(join(repo, '.claude/skills/verify-cairn'), { recursive: true });
    writeFileSync(join(repo, '.claude/skills/verify-cairn/feature-map.json'), '{}\n');
    writeFileSync(join(repo, 'scripts/fixture.test.mjs'), 'export {};\n');
    writeFileSync(join(repo, 'package.json'), '{"name":"cairn-test"}\n');
    const git = (...args) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    const baseSha = git('rev-parse', 'HEAD').trim();

    let lastBaseSha = null;
    const runClassify = (files, { baseOverride = baseSha, env = {} } = {}) => {
      for (const [rel, content] of Object.entries(files)) {
        mkdirSync(dirname(join(repo, rel)), { recursive: true });
        writeFileSync(join(repo, rel), content);
      }
      git('add', '.');
      git('commit', '-q', '-m', 'change');
      writeFileSync(outputFile, '');
      const run = spawnSync('bash', ['-e', '-c', classifyScript], {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...scrubGateEnv(),
          PREPUSH_BASE_SHA: baseOverride,
          GITHUB_REF: 'refs/heads/main',
          GITHUB_OUTPUT: outputFile,
          ...env,
        },
      });
      assert.equal(run.status, 0, run.stderr);
      const outputs = Object.fromEntries(
        readFileSync(outputFile, 'utf8')
          .trim()
          .split('\n')
          .map((line) => line.split('=')),
      );
      lastBaseSha = outputs['base-sha'];
      delete outputs['base-sha'];
      git('checkout', '-q', '-B', 'case', baseSha);
      return outputs;
    };

    assert.deepEqual(runClassify({ 'docs/research/note.md': 'note\n' }), {
      'has-code': 'false',
      'has-sidecar': 'false',
      'gates-needed': 'false',
      'ops-selftests': 'false',
      'needs-integration': 'false',
      'e2e-tier': 'none',
      'eval-needed': 'false',
    });
    assert.equal(lastBaseSha, baseSha);

    assert.deepEqual(runClassify({ 'apps/web/src/foo.test.ts': 'export {};\n' }), {
      'has-code': 'true',
      'has-sidecar': 'false',
      'gates-needed': 'true',
      'ops-selftests': 'false',
      'needs-integration': 'false',
      'e2e-tier': 'none',
      'eval-needed': 'false',
    });

    assert.deepEqual(runClassify({ 'apps/daemon/src/worker.ts': 'export const a = 1;\n' }), {
      'has-code': 'true',
      'has-sidecar': 'false',
      'gates-needed': 'true',
      'ops-selftests': 'false',
      'needs-integration': 'true',
      'e2e-tier': 'none',
      'eval-needed': 'false',
    });

    assert.deepEqual(runClassify({ 'apps/server/src/routes.ts': 'export const r = 1;\n' }), {
      'has-code': 'true',
      'has-sidecar': 'false',
      'gates-needed': 'true',
      'ops-selftests': 'false',
      'needs-integration': 'true',
      'e2e-tier': 'affected',
      'eval-needed': 'false',
    });

    assert.deepEqual(runClassify({ 'apps/web/src/pages/Home.tsx': 'export const h = 1;\n' }), {
      'has-code': 'true',
      'has-sidecar': 'false',
      'gates-needed': 'true',
      'ops-selftests': 'false',
      'needs-integration': 'false',
      'e2e-tier': 'affected',
      'eval-needed': 'false',
    });

    assert.deepEqual(
      runClassify({ 'apps/web/src/components/Button.tsx': 'export const b = 1;\n' }),
      {
        'has-code': 'true',
        'has-sidecar': 'false',
        'gates-needed': 'true',
        'ops-selftests': 'false',
        'needs-integration': 'false',
        'e2e-tier': 'full',
        'eval-needed': 'false',
      },
    );

    assert.deepEqual(runClassify({ 'packages/shared/src/index.ts': 'export const s = 1;\n' }), {
      'has-code': 'true',
      'has-sidecar': 'false',
      'gates-needed': 'true',
      'ops-selftests': 'true',
      'needs-integration': 'true',
      'e2e-tier': 'full',
      'eval-needed': 'false',
    });

    assert.deepEqual(runClassify({ 'apps/tsnet-sidecar/main.go': 'package main\n' }), {
      'has-code': 'true',
      'has-sidecar': 'true',
      'gates-needed': 'true',
      'ops-selftests': 'false',
      'needs-integration': 'false',
      'e2e-tier': 'none',
      'eval-needed': 'false',
    });

    assert.deepEqual(runClassify({ '.github/workflows/ci.yml': 'name: ci\n' }), {
      'has-code': 'true',
      'has-sidecar': 'false',
      'gates-needed': 'true',
      'ops-selftests': 'true',
      'needs-integration': 'true',
      'e2e-tier': 'none',
      'eval-needed': 'true',
    });

    assert.deepEqual(
      runClassify(
        { 'docs/research/note2.md': 'x\n' },
        { baseOverride: '0000000000000000000000000000000000000000' },
      ),
      {
        'has-code': 'true',
        'has-sidecar': 'true',
        'gates-needed': 'true',
        'ops-selftests': 'true',
        'needs-integration': 'true',
        'e2e-tier': 'full',
        'eval-needed': 'true',
      },
    );

    {
      git('update-ref', 'refs/remotes/origin/main', baseSha);
      mkdirSync(join(repo, 'apps/server/src'), { recursive: true });
      writeFileSync(join(repo, 'apps/server/src/routes.ts'), 'export const r = 1;\n');
      mkdirSync(join(repo, 'docs/research'), { recursive: true });
      writeFileSync(join(repo, 'docs/research/queue-note.md'), 'note\n');
      git('add', '.');
      git('commit', '-qm', 'lane server change');
      git('commit', '-qm', 'docs on top', '--allow-empty');
      writeFileSync(outputFile, '');
      const run = spawnSync('bash', ['-e', '-c', classifyScript], {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...scrubGateEnv(),
          PREPUSH_BASE_SHA: 'deadbeef000000000000000000000000000000',
          GITHUB_REF: 'refs/heads/queue/main',
          GITHUB_OUTPUT: outputFile,
        },
      });
      assert.equal(run.status, 0, run.stderr);
      const stacked = Object.fromEntries(
        readFileSync(outputFile, 'utf8')
          .trim()
          .split('\n')
          .map((line) => line.split('=')),
      );
      assert.equal(stacked['base-sha'], baseSha);
      delete stacked['base-sha'];
      assert.deepEqual(stacked, {
        'has-code': 'true',
        'has-sidecar': 'false',
        'gates-needed': 'true',
        'ops-selftests': 'false',
        'needs-integration': 'true',
        'e2e-tier': 'affected',
        'eval-needed': 'false',
      });
      git('checkout', '-q', '-B', 'case', baseSha);
      git('update-ref', '-d', 'refs/remotes/origin/main');
    }
  } finally {
    releaseTestTempDir(outer);
  }
});
