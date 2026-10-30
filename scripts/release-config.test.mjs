import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

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

function jobConfig(name) {
  const job = workflow.match(
    new RegExp(`^ {2}${name}:\\n[\\s\\S]*?(?=^ {2}\\S|(?![\\s\\S]))`, 'm'),
  )?.[0];
  assert.ok(job, `the ${name} job must exist`);
  return job;
}

function jobSteps(name) {
  return jobConfig(name)
    .split(/^ {6}- (?=(?:name|uses|run):)/m)
    .slice(1);
}

test('the release workflow publishes through OIDC without a token or a bot pull request', () => {
  for (const forbidden of ['changesets/action', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'registry-url']) {
    assert.ok(!workflow.includes(forbidden), `the release workflow must not contain ${forbidden}`);
  }
  assert.doesNotMatch(workflow, /\bNPM_CONFIG_PROVENANCE\b/);
});

test('packing inherits read permissions and publishing alone can request an OIDC token', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  const pack = jobConfig('pack');
  assert.doesNotMatch(pack, /id-token|^ {4}permissions:/m);
  assert.match(pack, /^ {4}if: github\.event_name == 'push'$/m);
  assert.match(pack, /^ {4}needs: config$/m);
  const publish = jobConfig('publish');
  assert.match(publish, /^ {4}permissions:\n(?: {6}.+\n)*? {6}id-token: write$/m);
  assert.match(publish, /^ {4}permissions:\n(?: {6}.+\n)*? {6}contents: write$/m);
  assert.match(publish, /^ {4}needs: pack$/m);
  assert.match(publish, /^ {4}if: needs\.pack\.outputs\.count != '0'$/m);
});

test('the publish job installs without scripts and never builds or publishes unpacked packages', () => {
  const steps = jobSteps('publish');
  const install = steps.find((step) => /\bpnpm install\b/.test(step));
  assert.ok(install, 'the publish job must install dependencies');
  assert.match(install, /\bpnpm install --frozen-lockfile --ignore-scripts\b/);
  for (const step of steps) {
    assert.doesNotMatch(step, /\bpnpm (?:run )?release:publish\b/);
    assert.doesNotMatch(step, /\bpnpm (?:run )?build\b/);
    for (const command of step.matchAll(/\bchangeset publish([^\n]*)/g)) {
      assert.match(command[1], /--from-pack-dir release-pack\b/);
    }
  }
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
  assert.match(steps[plan], /GITHUB_OUTPUT/);
  assert.match(jobConfig('pack'), /^ {6}count: \$\{\{ steps\.plan\.outputs\.count \}\}$/m);
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
