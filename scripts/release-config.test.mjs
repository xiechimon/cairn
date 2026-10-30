import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');

export function workspacePackages(rootDir = root) {
  const yaml = readFileSync(resolve(rootDir, 'pnpm-workspace.yaml'), 'utf8');
  const entries = [...yaml.matchAll(/^ {2}- (\S+)\s*$/gm)].map((match) => match[1]);
  const dirs = [];
  for (const entry of entries) {
    const base = entry.endsWith('*') ? entry.slice(0, -1) : null;
    if (base !== null) {
      const children = readdirSync(resolve(rootDir, base), { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => `${base}${dirent.name}`);
      dirs.push(...children);
    } else {
      dirs.push(entry);
    }
  }
  return dirs
    .map((dir) => ({
      ...JSON.parse(readFileSync(resolve(rootDir, dir, 'package.json'), 'utf8')),
      directory: dir,
    }))
    .filter((pkg) => pkg.name);
}

test('the changeset config ignores exactly the private workspace packages and keeps the rest publishable', () => {
  const config = JSON.parse(readFileSync(resolve(root, '.changeset/config.json'), 'utf8'));
  const ignored = new Set(config.ignore ?? []);
  for (const pkg of workspacePackages()) {
    if (pkg.private === true) {
      assert.ok(
        ignored.has(pkg.name),
        `${pkg.name} is private but not in the changeset config ignore list`,
      );
    } else {
      assert.ok(
        !ignored.has(pkg.name),
        `${pkg.name} is publishable but the changeset config ignores it`,
      );
      assert.equal(
        pkg.publishConfig?.access,
        'public',
        `${pkg.name} publishConfig.access must be public`,
      );
    }
  }
});

function jobConfig(name, text = workflow) {
  const job = text.match(
    new RegExp(`^ {2}${name}:\\n[\\s\\S]*?(?=^ {2}\\S|(?![\\s\\S]))`, 'm'),
  )?.[0];
  assert.ok(job, `the ${name} job must exist`);
  return job;
}

function jobSteps(name, text = workflow) {
  return jobConfig(name, text)
    .split(/^ {6}- (?=[a-z][a-z-]*:)/m)
    .slice(1);
}

test('the release workflow publishes through OIDC without a token or a bot pull request', () => {
  for (const forbidden of ['changesets/action', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'registry-url']) {
    assert.ok(!workflow.includes(forbidden), `the release workflow must not contain ${forbidden}`);
  }
  assert.doesNotMatch(workflow, /\bNPM_CONFIG_PROVENANCE\b/);
});

test('every release action pins a full commit SHA with a version note', () => {
  for (const [line] of workflow.matchAll(/^.*\buses:.*$/gm)) {
    assert.match(line, /^ +(?:- )?uses: [^@\s]+@[a-f0-9]{40} # v\d+\.\d+\.\d+$/);
  }
});

test('release jobs run only after their required dependencies and package count checks', () => {
  const pack = jobConfig('pack');
  assert.match(pack, /^ {4}if: github\.event_name == 'push'$/m);
  assert.match(pack, /^ {4}needs: config$/m);
  const publish = jobConfig('publish');
  assert.match(publish, /^ {4}needs: pack$/m);
  assert.match(publish, /^ {4}if: needs\.pack\.outputs\.count != '0'$/m);
});

test('the publish job sets up Node without restoring a shared dependency cache', () => {
  const setupNode = jobSteps('publish').find((step) => step.includes('uses: actions/setup-node@'));
  assert.ok(setupNode, 'the publish job must set up Node');
  assert.doesNotMatch(setupNode, /^\s*cache:/m);
});

test('the pack job packs tarballs before uploading the release artifact', () => {
  const steps = jobSteps('pack');
  const pack = steps.findIndex((step) => /\bchangeset pack --out-dir release-pack\b/.test(step));
  const upload = steps.findIndex((step) => step.includes('uses: actions/upload-artifact@'));
  assert.ok(pack >= 0, 'the pack job must pack unpublished versions');
  assert.ok(upload > pack, 'the pack job must upload the artifact after packing');
  assert.match(
    steps[upload],
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a\b/,
  );
  assert.match(steps[upload], /^ {10}name: release-pack$/m);
  assert.match(steps[upload], /^ {10}path: release-pack$/m);
  assert.match(steps[upload], /^ {8}if: steps\.plan\.outputs\.count != '0'$/m);
  const plan = steps.findIndex((step) => /^ {8}id: plan$/m.test(step));
  assert.ok(plan > pack && plan < upload, 'the pack job must count the plan before uploading');
  assert.match(steps[plan], /release-pack\/publish-plan\.json/);
});

test('the publish job downloads the packed artifact before publishing', () => {
  const steps = jobSteps('publish');
  const download = steps.findIndex((step) => step.includes('uses: actions/download-artifact@'));
  const publish = steps.findIndex((step) =>
    /\bchangeset publish --from-pack-dir release-pack\b/.test(step),
  );
  assert.ok(download >= 0, 'the publish job must download the release artifact');
  assert.ok(publish > download, 'the publish job must download tarballs before publishing');
  assert.match(
    steps[download],
    /actions\/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333\b/,
  );
  assert.match(steps[download], /^ {10}name: release-pack$/m);
  assert.match(steps[download], /^ {10}path: release-pack$/m);
});

test('pending changesets warn without controlling release steps', () => {
  const steps = jobSteps('pack');
  const detection = steps.find((step) => step.includes('.changeset/*.md'));
  assert.ok(detection, 'a step must detect pending changesets');
  assert.match(
    detection,
    /::warning::Pending changesets wait for a pull request that runs pnpm release:version: /,
  );
  assert.doesNotMatch(detection, /^ {8}id:|GITHUB_OUTPUT/m);
  for (const step of [...steps, ...jobSteps('publish')]) {
    assert.doesNotMatch(step, /^ {8}if: .*pending.*$/m);
  }
});

test('the publish job configures a tagger before publishing', () => {
  const steps = jobSteps('publish');
  const identity = steps.findIndex(
    (step) => /git config user\.name\s/.test(step) && /git config user\.email\s/.test(step),
  );
  const publish = steps.findIndex((step) =>
    /\bchangeset publish --from-pack-dir release-pack\b/.test(step),
  );
  assert.ok(identity >= 0, 'the publish job must set a git tagger name and email');
  assert.ok(publish > identity, 'the publish job must configure a tagger before publishing');
});

test('the publish step always publishes packed tarballs with explicit pnpm provenance', () => {
  const publish = jobSteps('publish').find((step) =>
    /\bchangeset publish --from-pack-dir release-pack\b/.test(step),
  );
  assert.ok(publish, 'the publish job must publish packed tarballs');
  assert.match(publish, /^ {8}id: publish$/m);
  assert.doesNotMatch(publish, /^ {8}if:/m);
  assert.match(publish, /^ {8}env:\n(?: {10}.+\n)*? {10}PNPM_CONFIG_PROVENANCE: 'true'$/m);
  assert.match(publish, /^ {8}env:\n(?: {10}.+\n)*? {10}PNPM_CONFIG_IGNORE_SCRIPTS: 'true'$/m);
});

test('the publish job pushes tags after an attempted publish even if publishing fails', () => {
  const steps = jobSteps('publish');
  const publish = steps.findIndex((step) =>
    /\bchangeset publish --from-pack-dir release-pack\b/.test(step),
  );
  const push = steps.findIndex((step) => /^ {8}run: git push origin --tags$/m.test(step));
  assert.ok(publish >= 0, 'the publish job must publish packed tarballs');
  assert.ok(push > publish, 'the publish job must push tags after publishing');
  assert.equal(
    steps[push].match(/^ {8}if: (.+)$/m)?.[1],
    `\${{ !cancelled() && steps.publish.outcome != 'skipped' }}`,
    'the tag push must require an attempted publish and run unless cancelled',
  );
});

test('pull requests validate release configuration for every workspace manifest', () => {
  const pullRequest = workflow.match(/^ {2}pull_request:\n[\s\S]*?(?=^\S)/m)?.[0];
  assert.ok(pullRequest, 'the release workflow must handle pull requests');
  assert.match(pullRequest, /^ {4}paths:\n(?: {6}.+\n)*? {6}- '\*\*\/package\.json'\s*$/m);
});

test('every publishable package names this repository for provenance', () => {
  for (const pkg of workspacePackages().filter((pkg) => pkg.private !== true)) {
    assert.equal(
      pkg.publishConfig?.provenance,
      true,
      `${pkg.name} publishConfig.provenance must be true`,
    );
    assert.equal(pkg.repository?.type, 'git', `${pkg.name} repository.type must be git`);
    assert.equal(
      pkg.repository?.url,
      'git+https://github.com/xiechimon/cairn.git',
      `${pkg.name} repository.url must name this repository`,
    );
    assert.equal(
      pkg.repository?.directory,
      pkg.directory,
      `${pkg.name} repository.directory must match its workspace directory`,
    );
  }
});

function workflowBlocks(text, key, indentation) {
  const lines = text.split('\n');
  const header = new RegExp(`^ {${indentation}}${key}:(.*)$`);
  return lines.flatMap((line, index) => {
    const match = line.match(header);
    if (!match) return [];
    const body = [];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() && next.search(/\S/) <= indentation) break;
      body.push(next.trim());
    }
    return [{ value: match[1].trim(), body: body.filter(Boolean) }];
  });
}

function releaseWorkflowViolations(text) {
  const violations = [];
  const topPermissions = workflowBlocks(text, 'permissions', 0);
  if (!isDeepStrictEqual(topPermissions, [{ value: '', body: ['contents: read'] }])) {
    violations.push('top-level permissions must be exactly contents: read');
  }
  for (const name of ['config', 'pack', 'publish']) {
    if (!new RegExp(`^ {2}${name}:$`, 'm').test(text)) {
      violations.push(`${name} job must exist`);
    }
  }
  if (violations.some((violation) => violation.endsWith('job must exist'))) return violations;
  for (const name of ['config', 'pack']) {
    if (workflowBlocks(jobConfig(name, text), 'permissions', 4).length !== 0) {
      violations.push(`${name} permissions must be inherited without a job declaration`);
    }
  }
  const publishPermissions = workflowBlocks(jobConfig('publish', text), 'permissions', 4);
  for (const block of publishPermissions) block.body.sort();
  if (
    !isDeepStrictEqual(publishPermissions, [
      { value: '', body: ['contents: write', 'id-token: write'] },
    ])
  ) {
    violations.push('publish permissions must be exactly contents: write and id-token: write');
  }
  const publishSteps = jobSteps('publish', text).map((step) => `        ${step}`);
  const actions = publishSteps.flatMap((step) =>
    workflowBlocks(step, 'uses', 8).map((block) => block.value.split('@')[0]),
  );
  if (
    !isDeepStrictEqual(actions, [
      'actions/checkout',
      'pnpm/action-setup',
      'actions/setup-node',
      'actions/download-artifact',
    ])
  ) {
    violations.push('publish uses actions must match the exact ordered repository list');
  }
  const commands = publishSteps.flatMap((step) =>
    workflowBlocks(step, 'run', 8).flatMap((block) =>
      (block.value === '|' ? block.body.join('\n').trim() : block.value).split('\n'),
    ),
  );
  if (
    !isDeepStrictEqual(commands, [
      'pnpm install --frozen-lockfile --ignore-scripts --filter .',
      "git config user.name 'github-actions[bot]'",
      "git config user.email '41898282+github-actions[bot]@users.noreply.github.com'",
      'pnpm exec changeset publish --from-pack-dir release-pack',
      'git push origin --tags',
    ])
  ) {
    violations.push('publish run commands must match the exact ordered command list');
  }
  const pack = jobConfig('pack', text);
  const outputs = workflowBlocks(pack, 'outputs', 4);
  if (
    !isDeepStrictEqual(outputs, [{ value: '', body: [`count: \${{ steps.plan.outputs.count }}`] }])
  ) {
    violations.push('pack job outputs must contain only count mapped to steps.plan.outputs.count');
  }
  const plans = jobSteps('pack', text).filter((step) => /^ {8}id: plan$/m.test(step));
  const plan = plans.join('\n');
  const outputWrites = [
    ...plan.matchAll(/\bfs\.appendFileSync\(process\.env\.GITHUB_OUTPUT,\s*`([^`]*)`\);/g),
  ].map((match) => match[1]);
  if (
    plans.length !== 1 ||
    !isDeepStrictEqual(outputWrites, [`count=\${count}\\n`]) ||
    [...plan.matchAll(/\bGITHUB_OUTPUT\b/g)].length !== 1
  ) {
    violations.push('pack plan output key must be exactly count with no additional output writes');
  }
  return violations;
}

const workflowFixtures = [
  {
    name: '1: top-level OIDC permission',
    before: 'permissions:\n  contents: read',
    after: 'permissions:\n  contents: read\n  id-token: write',
    rule: 'top-level permissions',
  },
  {
    name: '2: rebuild in publish',
    before: '      - name: Publish to npm',
    after: '      - run: pnpm rebuild\n      - name: Publish to npm',
    rule: 'publish run commands',
  },
  {
    name: '3: recursive build in publish',
    before: '      - name: Publish to npm',
    after: '      - run: pnpm -r build\n      - name: Publish to npm',
    rule: 'publish run commands',
  },
  {
    name: '4: renamed plan output',
    before: `count=\${count}`,
    after: `total=\${count}`,
    rule: 'pack plan output key',
  },
  {
    name: '5: filtered build in publish',
    before: '      - name: Publish to npm',
    after: '      - run: pnpm --filter @xiechimon/cairn build\n      - name: Publish to npm',
    rule: 'publish run commands',
  },
  {
    name: '6: pack in publish',
    before: '      - name: Publish to npm',
    after:
      '      - run: pnpm exec changeset pack --out-dir release-pack\n      - name: Publish to npm',
    rule: 'publish run commands',
  },
  {
    name: '7: cache action in publish',
    before: '      - name: Publish to npm',
    after: '      - uses: actions/cache@v4\n      - name: Publish to npm',
    rule: 'publish uses actions',
  },
];

test('the release workflow satisfies the exact security invariants', () => {
  assert.deepEqual(releaseWorkflowViolations(workflow), []);
});

for (const { name, before, after, rule } of workflowFixtures) {
  test(`the exact security invariants reject fixture ${name}`, () => {
    assert.equal(
      workflow.split(before).length - 1,
      1,
      `fixture replacement must match once: ${before}`,
    );
    const fixture = workflow.replace(before, after);
    const violations = releaseWorkflowViolations(fixture);
    assert.ok(violations.length > 0, `${name} must break ${rule}`);
    assert.ok(
      violations.some((violation) => violation.includes(rule)),
      violations.join('\n'),
    );
  });
}
