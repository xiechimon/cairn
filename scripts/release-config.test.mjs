import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');

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

function releaseSteps() {
  const workflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
  const release = workflow.match(/^ {2}release:\n[\s\S]*/m);
  assert.ok(release, 'the release job must exist');
  return release[0].split(/^ {6}- /m).slice(1);
}

test('the release workflow publishes through OIDC without a token or a bot pull request', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
  for (const forbidden of ['changesets/action', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'registry-url']) {
    assert.ok(!workflow.includes(forbidden), `the release workflow must not contain ${forbidden}`);
  }
  assert.match(workflow, /^ {2}release:\n[\s\S]*?\n {6}id-token: write\s*$/m);
  assert.match(workflow, /^ {2}release:\n[\s\S]*?\n {6}contents: write\s*$/m);
});

test('pending changesets warn without controlling release steps', () => {
  const steps = releaseSteps();
  const detection = steps.find((step) => step.includes('.changeset/*.md'));
  assert.ok(detection, 'a step must detect pending changesets');
  assert.match(
    detection,
    /::warning::Pending changesets wait for a pull request that runs pnpm release:version: /,
  );
  assert.doesNotMatch(detection, /GITHUB_OUTPUT/);
  for (const step of steps) {
    assert.doesNotMatch(step, /^ {8}if: .*pending.*$/m);
  }
});

test('the release job configures a tagger before publishing', () => {
  const steps = releaseSteps();
  const identity = steps.findIndex(
    (step) => /git config user\.name\s/.test(step) && /git config user\.email\s/.test(step),
  );
  const publish = steps.findIndex((step) => /^ {8}run: pnpm run release:publish$/m.test(step));
  assert.ok(identity >= 0, 'the release job must set a git tagger name and email');
  assert.ok(publish > identity, 'the release job must configure a tagger before publishing');
});

test('the release job always publishes with explicit provenance', () => {
  const steps = releaseSteps();
  const publish = steps.find((step) => /^ {8}run: pnpm run release:publish$/m.test(step));
  assert.ok(publish, 'the release job must run release:publish');
  assert.doesNotMatch(publish, /^ {8}if:/m);
  assert.match(publish, /^ {8}env:\n(?: {10}.+\n)*? {10}NPM_CONFIG_PROVENANCE: 'true'\s*$/m);
});

test('the release job pushes tags even after a partial publish failure', () => {
  const steps = releaseSteps();
  const publish = steps.findIndex((step) => /^ {8}run: pnpm run release:publish$/m.test(step));
  const push = steps.findIndex((step) => /^ {8}run: git push origin --tags$/m.test(step));
  assert.ok(publish >= 0, 'the release job must run release:publish');
  assert.ok(push > publish, 'the release job must push tags after publishing');
  assert.equal(
    steps[push].match(/^ {8}if: (.+)$/m)?.[1],
    `\${{ !cancelled() }}`,
    'the tag push must run after a failed publish unless cancelled',
  );
});

test('pull requests validate release configuration for every workspace manifest', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
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
