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

test('the pack job depends on config and runs only on pushes', () => {
  const pack = jobConfig('pack');
  assert.match(pack, /^ {4}if: github\.event_name == 'push'$/m);
  assert.match(pack, /^ {4}needs: config$/m);
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

test('the publish job pushes tags after publishing', () => {
  const steps = jobSteps('publish');
  const publish = steps.findIndex((step) =>
    /\bchangeset publish --from-pack-dir release-pack\b/.test(step),
  );
  const push = steps.findIndex((step) => /^ {8}run: git push origin --tags$/m.test(step));
  assert.ok(publish >= 0, 'the publish job must publish packed tarballs');
  assert.ok(push > publish, 'the publish job must push tags after publishing');
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

const expectedReleaseHeader = `name: release

on:
  push:
    branches: [main]
  pull_request:
    paths:
      - '.changeset/**'
      - '.github/workflows/release.yml'
      - '**/package.json'
      - 'pnpm-lock.yaml'
      - 'pnpm-workspace.yaml'
      - 'scripts/release-config.test.mjs'

concurrency:
  group: release-\${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
`;

const expectedPublishJob = `  publish:
    needs: pack
    if: needs.pack.outputs.count != '0'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
        with:
          node-version: 24
      - name: Install dependencies without scripts
        run: pnpm install --frozen-lockfile --ignore-scripts --filter .
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: release-pack
          path: release-pack
      - name: Configure tag identity
        run: |
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
      - name: Publish to npm
        id: publish
        env:
          PNPM_CONFIG_PROVENANCE: 'true'
          PNPM_CONFIG_IGNORE_SCRIPTS: 'true'
        run: pnpm exec changeset publish --from-pack-dir release-pack
      - name: Push release tags
        if: \${{ !cancelled() && steps.publish.outcome != 'skipped' }}
        run: git push origin --tags
`;

function releaseWorkflowViolations(text) {
  const violations = [];
  const jobsLine = text.match(/^jobs:\n/m);
  const publishLine = text.match(/^ {2}publish:\n/m);
  const hasBoundaries = Boolean(jobsLine && publishLine && jobsLine.index < publishLine.index);
  if (!jobsLine || text.slice(0, jobsLine.index + jobsLine[0].length) !== expectedReleaseHeader) {
    violations.push('release workflow header must match the pinned text');
  }
  if (!publishLine || text.slice(publishLine.index) !== expectedPublishJob) {
    violations.push('publish job must match the pinned text');
  }
  const precedingJobs = hasBoundaries
    ? text.slice(jobsLine.index + jobsLine[0].length, publishLine.index)
    : '';
  const jobNames = precedingJobs.split('\n').filter((line) => /^ {0,2}[^\s#]/.test(line));
  const hasExpectedJobs = hasBoundaries && isDeepStrictEqual(jobNames, ['  config:', '  pack:']);
  if (!hasExpectedJobs) {
    violations.push('jobs must be exactly config, pack and publish');
  }
  if (
    text.split('id-token').length - 1 !== 1 ||
    !hasBoundaries ||
    !text.slice(publishLine.index).includes('id-token')
  ) {
    violations.push('only publish may request id-token');
  }
  if (precedingJobs.includes('permissions')) {
    violations.push('config and pack must not declare permissions');
  }
  if (!hasExpectedJobs) return violations;
  const pack = jobConfig('pack', text);
  const outputs = [...pack.matchAll(/^ {4}outputs:([^\n]*)\n((?: {6}[^\n]*\n)*)/gm)];
  if (
    outputs.length !== 1 ||
    outputs[0][1] !== '' ||
    outputs[0][2] !== `      count: \${{ steps.plan.outputs.count }}\n`
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
    rule: 'release workflow header must match the pinned text',
  },
  {
    name: '2: rebuild in publish',
    before: '      - name: Publish to npm',
    after: '      - run: pnpm rebuild\n      - name: Publish to npm',
    rule: 'publish job must match the pinned text',
  },
  {
    name: '3: recursive build in publish',
    before: '      - name: Publish to npm',
    after: '      - run: pnpm -r build\n      - name: Publish to npm',
    rule: 'publish job must match the pinned text',
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
    rule: 'publish job must match the pinned text',
  },
  {
    name: '6: pack in publish',
    before: '      - name: Publish to npm',
    after:
      '      - run: pnpm exec changeset pack --out-dir release-pack\n      - name: Publish to npm',
    rule: 'publish job must match the pinned text',
  },
  {
    name: '7: cache action in publish',
    before: '      - name: Publish to npm',
    after: '      - uses: actions/cache@v4\n      - name: Publish to npm',
    rule: 'publish job must match the pinned text',
  },
  {
    name: '8: comment before an appended publish command',
    before: '        run: git push origin --tags\n',
    after: '        run: git push origin --tags\n  # x\n      - run: curl x\n',
    rule: 'publish job must match the pinned text',
  },
  {
    name: '9: flow-style build step',
    before: '      - name: Publish to npm',
    after: '      - {run: pnpm -r build}\n      - name: Publish to npm',
    rule: 'publish job must match the pinned text',
  },
  {
    name: '10: extra spaces before a run key',
    before: '      - name: Publish to npm',
    after: '      -   run: pnpm rebuild\n      - name: Publish to npm',
    rule: 'publish job must match the pinned text',
  },
  {
    name: '11: quoted run key',
    before: '      - name: Publish to npm',
    after: '      - "run": pnpm rebuild\n      - name: Publish to npm',
    rule: 'publish job must match the pinned text',
  },
  {
    name: '12: space before a uses colon',
    before: '      - name: Publish to npm',
    after: '      - uses : actions/cache@v4\n      - name: Publish to npm',
    rule: 'publish job must match the pinned text',
  },
  {
    name: '13: unquoted install continuation',
    before: '        run: pnpm install --frozen-lockfile --ignore-scripts --filter .\n',
    after:
      '        run: pnpm install --frozen-lockfile --ignore-scripts --filter .\n          ; pnpm -r build\n',
    rule: 'publish job must match the pinned text',
  },
  {
    name: '14: fourth job with OIDC permission',
    before: '  publish:\n',
    after: '  evil:\n    permissions:\n      id-token: write\n  publish:\n',
    rule: 'jobs must be exactly config, pack and publish',
  },
  {
    name: '15: publish step shell',
    before: '        id: publish\n',
    after: '        id: publish\n        shell: node {0}\n',
    rule: 'publish job must match the pinned text',
  },
  {
    name: '16: publish step environment injection',
    before: "          PNPM_CONFIG_PROVENANCE: 'true'\n",
    after: "          PNPM_CONFIG_PROVENANCE: 'true'\n          NODE_OPTIONS: --require ./x.js\n",
    rule: 'publish job must match the pinned text',
  },
  {
    name: '17: publish checkout ref input',
    before: '          fetch-depth: 0\n',
    after: '          fetch-depth: 0\n          ref: evil\n',
    rule: 'publish job must match the pinned text',
  },
  {
    name: '18: different publish checkout SHA',
    before:
      '      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0\n        with:\n          fetch-depth: 0',
    after:
      '      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v5.1.0\n        with:\n          fetch-depth: 0',
    rule: 'publish job must match the pinned text',
  },
  {
    name: '19: publish job container',
    before: '  publish:\n',
    after: '  publish:\n    container: evil/image\n',
    rule: 'publish job must match the pinned text',
  },
  {
    name: '20: top-level OIDC permission after a comment',
    before: 'permissions:\n  contents: read\n',
    after: 'permissions:\n  contents: read\n# scope\n  id-token: write\n',
    rule: 'release workflow header must match the pinned text',
  },
  {
    name: '21: top-level env between pack and publish',
    before: '  publish:\n',
    after: 'env:\n  NODE_OPTIONS: --require ./x.js\n  publish:\n',
    rule: 'jobs must be exactly config, pack and publish',
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

test('missing workflow boundary lines are violations rather than exceptions', () => {
  for (const [line, rule] of [
    ['jobs:\n', 'release workflow header must match the pinned text'],
    ['  publish:\n', 'publish job must match the pinned text'],
  ]) {
    assert.equal(workflow.split(line).length - 1, 1);
    assert.ok(releaseWorkflowViolations(workflow.replace(line, '')).includes(rule));
  }
});
