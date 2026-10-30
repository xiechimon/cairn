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
});

test('the release job publishes only when no changesets are pending', () => {
  const steps = releaseSteps();
  const detection = steps.find((step) => step.includes('.changeset/*.md'));
  assert.ok(detection, 'a step must detect pending changesets');
  const id = detection.match(/^ {8}id: (\w+)$/m)?.[1];
  assert.ok(id, 'the changeset detection step must have an id');
  assert.match(detection, /if \[\[ "\$file" != "\.changeset\/README\.md" \]\]/);
  assert.match(
    detection,
    /if \(\( \$\{#pending\[@\]\} > 0 \)\); then[\s\S]*?::warning::[\s\S]*?else/,
  );
  assert.match(detection, /pending=true[^\n]*>> "\$GITHUB_OUTPUT"/);
  assert.match(detection, /pending=false[^\n]*>> "\$GITHUB_OUTPUT"/);
  const publish = steps.find((step) => /^ {8}run: pnpm run release:publish$/m.test(step));
  assert.ok(publish, 'the release job must run release:publish');
  assert.ok(publish.includes(`if: steps.${id}.outputs.pending == 'false'`));
  assert.ok(steps.indexOf(detection) < steps.indexOf(publish));
});

test('the release job pushes the tags changeset publish creates', () => {
  const steps = releaseSteps();
  const publish = steps.findIndex((step) => /^ {8}run: pnpm run release:publish$/m.test(step));
  const push = steps.findIndex((step) => /^ {8}run: git push origin --tags$/m.test(step));
  assert.ok(publish >= 0, 'the release job must run release:publish');
  assert.ok(push > publish, 'the release job must push tags after publishing');
  assert.equal(
    steps[push].match(/^ {8}if: (.+)$/m)?.[1],
    steps[publish].match(/^ {8}if: (.+)$/m)?.[1],
    'publishing and pushing tags must share the pending changeset condition',
  );
});

test('every publishable package names this repository for provenance', () => {
  for (const pkg of workspacePackages().filter((pkg) => pkg.private !== true)) {
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
