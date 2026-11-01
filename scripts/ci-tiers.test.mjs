import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

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
  return new Function('startsWith', `return (${js});`)(startsWith);
}

const condition = (name) => job(name).match(/^ {4}if: (.*)$/m)?.[1];
const tierExpression = job('changes').match(/^ {6}e2e-tier: (.*)$/m)?.[1];

function githubContext({ event, draft = null, login = null, head = '' }) {
  return {
    'github.event_name': event,
    'github.event.pull_request.draft': draft,
    'github.event.pull_request.user.login': login,
    'github.head_ref': head,
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
  'merge-queue draft': githubContext({
    event: 'pull_request',
    draft: true,
    login: 'mergify[bot]',
    head: 'mergify/merge-queue/0123456789abcdef',
  }),
  'non-draft PR from a mergify branch': githubContext({
    event: 'pull_request',
    draft: false,
    login: 'mergify[bot]',
    head: 'mergify/merge-queue/0123456789abcdef',
  }),
  'draft PR from a mergify branch by a person': githubContext({
    event: 'pull_request',
    draft: true,
    login: 'xiechimon',
    head: 'mergify/merge-queue/0123456789abcdef',
  }),
  'mergify draft on another branch': githubContext({
    event: 'pull_request',
    draft: true,
    login: 'mergify[bot]',
    head: 'mergify/bp/main/pr-1',
  }),
  'push to main': githubContext({ event: 'push' }),
};
const fullTier = new Set(['merge-queue draft', 'push to main']);

function plan(github, hasCode) {
  const changes = { 'needs.changes.outputs.has-code': hasCode };
  changes['needs.changes.outputs.e2e-tier'] = evaluate(tierExpression, github);
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
    .map((scenario) => `(\nset -e -o pipefail\n${gateShell(scenario)}\n) >/dev/null 2>&1; echo $?`)
    .join('\n');
  const run = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const statuses = run.stdout.trim().split('\n');
  assert.equal(statuses.length, scenarios.length);
  return statuses.map((status) => status === '0');
}

test('the full 4-shard e2e runs exactly on merge-queue drafts and pushes', () => {
  assert.ok(tierExpression);
  assert.match(job('e2e'), /shard: \[1, 2, 3, 4\]/);
  assert.match(job('e2e'), /run: pnpm prepush --e2e-shard \$\{\{ matrix.shard \}\}\/4/);
  assert.match(job('e2e-affected'), /run: pnpm --filter @cairn\/web e2e:affected\n/);
  assert.match(job('e2e-affected'), /fetch-depth: 0/);
  assert.doesNotMatch(job('e2e-affected'), /shard/);
  for (const [name, github] of Object.entries(events)) {
    const full = fullTier.has(name);
    const { tier, e2e, 'e2e-affected': affected } = plan(github, 'true');
    assert.equal(tier, full ? 'full' : 'affected', name);
    assert.equal(e2e, full, `${name}: e2e`);
    assert.equal(affected, !full, `${name}: e2e-affected`);
  }
});

test('a docs-only pull request skips both e2e tiers, a push never does', () => {
  for (const [name, github] of Object.entries(events)) {
    const { e2e, 'e2e-affected': affected } = plan(github, 'false');
    const push = github['github.event_name'] === 'push';
    assert.equal(e2e, push, `${name}: e2e`);
    assert.equal(affected, false, `${name}: e2e-affected`);
  }
});

test('e2e-gate passes only when the tier it picked ran and succeeded', () => {
  assert.match(job('e2e-gate'), /^ {4}needs: \[changes, e2e, e2e-affected\]$/m);
  assert.match(job('e2e-gate'), /^ {4}if: always\(\)$/m);
  assert.doesNotMatch(job('e2e-gate'), /uses:|checkout|continue-on-error|mergify/);
  const outcomes = ['success', 'failure', 'cancelled'];
  const scenarios = [];
  for (const [name, github] of Object.entries(events))
    for (const hasCode of ['true', 'false']) {
      const ran = plan(github, hasCode);
      for (const e2e of ran.e2e ? outcomes : ['skipped'])
        for (const affected of ran['e2e-affected'] ? outcomes : ['skipped'])
          scenarios.push({
            name,
            results: { changes: 'success', e2e, 'e2e-affected': affected },
            outputs: { 'has-code': hasCode, 'e2e-tier': ran.tier },
            expected:
              ![e2e, affected].some((result) => result === 'failure' || result === 'cancelled') &&
              (hasCode === 'false' || e2e === 'success' || affected === 'success'),
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
    const full = outputs['e2e-tier'] === 'full';
    const [ran, idle] = full
      ? [results.e2e, results['e2e-affected']]
      : [results['e2e-affected'], results.e2e];
    assert.equal(results.changes, 'success', label);
    assert.ok(full || outputs['e2e-tier'] === 'affected', label);
    assert.equal(idle, 'skipped', label);
    assert.ok(ran === 'success' || (outputs['has-code'] === 'false' && ran === 'skipped'), label);
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
