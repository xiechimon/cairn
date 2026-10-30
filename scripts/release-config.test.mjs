import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8').replace(
  /\r\n/g,
  '\n',
);

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

const expectedReleaseWorkflow = `name: release

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
  config:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
        with:
          node-version: 24
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Release config invariant
        run: node --test scripts/release-config.test.mjs

  pack:
    if: github.event_name == 'push'
    needs: config
    runs-on: ubuntu-latest
    outputs:
      count: \${{ steps.plan.outputs.count }}
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
        with:
          node-version: 24
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Detect pending changesets
        run: |
          shopt -s nullglob
          pending=()
          for file in .changeset/*.md; do
            if [[ "$file" != ".changeset/README.md" ]]; then
              pending+=("$file")
            fi
          done
          if (( \${#pending[@]} > 0 )); then
            echo "::warning::Pending changesets wait for a pull request that runs pnpm release:version: \${pending[*]}"
          fi
      - name: Pack unpublished versions
        run: pnpm exec changeset pack --out-dir release-pack
      - name: Count packages to publish
        id: plan
        run: |
          node -e 'const fs = require("node:fs"); const { plan } = JSON.parse(fs.readFileSync("release-pack/publish-plan.json", "utf8")); const count = plan.flat().filter(entry => entry.kind === "publish").length; fs.appendFileSync(process.env.GITHUB_OUTPUT, \`count=\${count}\\n\`);'
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        if: steps.plan.outputs.count != '0'
        with:
          name: release-pack
          path: release-pack

  publish:
    needs: pack
    if: needs.pack.outputs.count != '0'
    runs-on: ubuntu-latest
    environment: npm
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
  return text.replace(/\r\n/g, '\n') === expectedReleaseWorkflow
    ? []
    : ['release workflow must match the pinned text'];
}

export const workflowFixtures = [
  {
    name: '1: top-level OIDC permission',
    before: 'permissions:\n  contents: read',
    after: 'permissions:\n  contents: read\n  id-token: write',
  },
  {
    name: '2: rebuild in publish',
    before: '      - name: Publish to npm',
    after: '      - run: pnpm rebuild\n      - name: Publish to npm',
  },
  {
    name: '3: recursive build in publish',
    before: '      - name: Publish to npm',
    after: '      - run: pnpm -r build\n      - name: Publish to npm',
  },
  {
    name: '4: renamed plan output',
    before: `count=\${count}`,
    after: `total=\${count}`,
  },
  {
    name: '5: filtered build in publish',
    before: '      - name: Publish to npm',
    after: '      - run: pnpm --filter @xiechimon/cairn build\n      - name: Publish to npm',
  },
  {
    name: '6: pack in publish',
    before: '      - name: Publish to npm',
    after:
      '      - run: pnpm exec changeset pack --out-dir release-pack\n      - name: Publish to npm',
  },
  {
    name: '7: cache action in publish',
    before: '      - name: Publish to npm',
    after: '      - uses: actions/cache@v4\n      - name: Publish to npm',
  },
  {
    name: '8: comment before an appended publish command',
    before: '        run: git push origin --tags\n',
    after: '        run: git push origin --tags\n  # x\n      - run: curl x\n',
  },
  {
    name: '9: flow-style build step',
    before: '      - name: Publish to npm',
    after: '      - {run: pnpm -r build}\n      - name: Publish to npm',
  },
  {
    name: '10: extra spaces before a run key',
    before: '      - name: Publish to npm',
    after: '      -   run: pnpm rebuild\n      - name: Publish to npm',
  },
  {
    name: '11: quoted run key',
    before: '      - name: Publish to npm',
    after: '      - "run": pnpm rebuild\n      - name: Publish to npm',
  },
  {
    name: '12: space before a uses colon',
    before: '      - name: Publish to npm',
    after: '      - uses : actions/cache@v4\n      - name: Publish to npm',
  },
  {
    name: '13: unquoted install continuation',
    before: '        run: pnpm install --frozen-lockfile --ignore-scripts --filter .\n',
    after:
      '        run: pnpm install --frozen-lockfile --ignore-scripts --filter .\n          ; pnpm -r build\n',
  },
  {
    name: '14: fourth job with OIDC permission',
    before: '  publish:\n',
    after: '  evil:\n    permissions:\n      id-token: write\n  publish:\n',
  },
  {
    name: '15: publish step shell',
    before: '        id: publish\n',
    after: '        id: publish\n        shell: node {0}\n',
  },
  {
    name: '16: publish step environment injection',
    before: "          PNPM_CONFIG_PROVENANCE: 'true'\n",
    after: "          PNPM_CONFIG_PROVENANCE: 'true'\n          NODE_OPTIONS: --require ./x.js\n",
  },
  {
    name: '17: publish checkout ref input',
    before: '          fetch-depth: 0\n',
    after: '          fetch-depth: 0\n          ref: evil\n',
  },
  {
    name: '18: different publish checkout SHA',
    before:
      '      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0\n        with:\n          fetch-depth: 0',
    after:
      '      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v5.1.0\n        with:\n          fetch-depth: 0',
  },
  {
    name: '19: publish job container',
    before: '  publish:\n',
    after: '  publish:\n    container: evil/image\n',
  },
  {
    name: '20: top-level OIDC permission after a comment',
    before: 'permissions:\n  contents: read\n',
    after: 'permissions:\n  contents: read\n# scope\n  id-token: write\n',
  },
  {
    name: '21: top-level env between pack and publish',
    before: '  publish:\n',
    after: 'env:\n  NODE_OPTIONS: --require ./x.js\n  publish:\n',
  },
  {
    name: '22: escaped pack OIDC permission keys',
    before: '    needs: config\n',
    after: '    needs: config\n    "\\x70ermissions":\n      "id-\\x74oken": write\n',
  },
  {
    name: '23: environment removed from publish',
    before: '    runs-on: ubuntu-latest\n    environment: npm\n',
    after: '    runs-on: ubuntu-latest\n',
  },
];

test('the release workflow matches the pinned text', () => {
  const violations = releaseWorkflowViolations(workflow);
  if (violations.length > 0) assert.equal(workflow, expectedReleaseWorkflow);
  assert.deepEqual(violations, []);
});

test('the release workflow pin accepts CRLF line endings', () => {
  assert.deepEqual(releaseWorkflowViolations(workflow.replace(/\n/g, '\r\n')), []);
});

test('the pinned workflow grants an OIDC token only after the publish job begins', () => {
  assert.equal(expectedReleaseWorkflow.split('id-token: write').length - 1, 1);
  assert.ok(
    expectedReleaseWorkflow.indexOf('id-token: write') >
      expectedReleaseWorkflow.indexOf('  publish:'),
  );
});

test('the pinned workflow names the npm environment exactly once inside the publish job', () => {
  assert.equal(expectedReleaseWorkflow.split('\n    environment: npm\n').length - 1, 1);
  assert.match(expectedReleaseWorkflow, /^ {2}publish:\n(?: {4}.*\n)* {4}environment: npm\n/m);
});

for (const { name, before, after } of workflowFixtures) {
  test(`the workflow pin rejects fixture ${name}`, () => {
    assert.equal(
      workflow.split(before).length - 1,
      1,
      `fixture replacement must match once: ${before}`,
    );
    assert.deepEqual(releaseWorkflowViolations(workflow.replace(before, () => after)), [
      'release workflow must match the pinned text',
    ]);
  });
}
