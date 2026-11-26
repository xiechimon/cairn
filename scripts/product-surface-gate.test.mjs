import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const GATE = resolve(import.meta.dirname, 'product-surface-gate.mjs');

function sandbox() {
  const dir = makeTestTempDir('product-surface-gate-');
  const write = (path, text) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'gate@test.invalid');
  git('config', 'user.name', 'gate test');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(GATE, join(dir, 'scripts/product-surface-gate.mjs'));
  write('scripts/product-surface-registry.json', '{"version":1,"surfaces":[]}\n');
  write(
    'packages/shared/src/records/team.ts',
    `import { z } from 'zod';\nexport const patchTeamBodySchema = z.object({\n  displayName: z.string().optional(),\n});\n`,
  );
  write(
    'packages/shared/src/records/machine.ts',
    `import { z } from 'zod';\nexport const machineRecordSchema = z.object({\n  id: z.string(),\n  name: z.string(),\n});\nexport const patchMachineBodySchema = z.object({\n  name: z.string().optional(),\n});\n`,
  );
  write(
    'apps/server/src/db/schema.ts',
    `export const machine = sqliteTable(\n  'machine',\n  {\n    id: text('id').primaryKey(),\n    name: text('name').notNull(),\n  },\n);\n`,
  );
  write('apps/server/src/services/chief.ts', 'export const prompt = `short`;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('switch', '-q', '-c', 'feature');
  const gate = (args = []) =>
    spawnSync('node', ['scripts/product-surface-gate.mjs', ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
  const commit = (message = 'feature') => {
    git('add', '.');
    git('commit', '-q', '-m', message);
  };
  const registry = (rows) =>
    write(
      'scripts/product-surface-registry.json',
      `${JSON.stringify({ version: 1, surfaces: rows }, null, 2)}\n`,
    );
  return { dir, write, git, gate, commit, registry };
}

function withSandbox(fn) {
  const s = sandbox();
  try {
    fn(s);
  } finally {
    releaseTestTempDir(s.dir);
  }
}

test('a new CAIRN env var is red without a registry row and green with one', () => {
  withSandbox((s) => {
    s.write('apps/server/src/config.ts', 'export const slots = process.env.CAIRN_HEAVY_SLOTS;\n');
    s.write('scripts/tool.sh', `slots="\${CAIRN_TEST_SHELL_SLOTS:-2}"\n`);
    const red = s.gate();
    assert.equal(red.status, 1, red.stdout + red.stderr);
    assert.match(red.stdout, /env CAIRN_HEAVY_SLOTS/);
    assert.match(red.stdout, /env CAIRN_TEST_SHELL_SLOTS/);
    s.registry([
      {
        type: 'env',
        key: 'CAIRN_HEAVY_SLOTS',
        scope: 'dev-tooling',
        userScenario: 'A maintainer meets it only while running repository test tooling.',
      },
      {
        type: 'env',
        key: 'CAIRN_TEST_SHELL_SLOTS',
        scope: 'dev-tooling',
        userScenario: 'A maintainer meets it only while running repository shell tooling.',
      },
    ]);
    const green = s.gate();
    assert.equal(green.status, 0, green.stdout + green.stderr);
  });
});

test('the runner auto-dispatch and concurrency fields are red without a registry row', () => {
  withSandbox((s) => {
    s.write(
      'packages/shared/src/records/machine.ts',
      `import { z } from 'zod';\nexport const machineRecordSchema = z.object({\n  id: z.string(),\n  name: z.string(),\n  maxConcurrency: z.number().nullable().optional(),\n  autoDispatch: z.boolean().optional(),\n});\nexport const patchMachineBodySchema = z.object({\n  name: z.string().optional(),\n  maxConcurrency: z.number().nullable().optional(),\n  autoDispatch: z.boolean().optional(),\n});\n`,
    );
    s.write(
      'apps/server/src/db/schema.ts',
      `export const machine = sqliteTable(\n  'machine',\n  {\n    id: text('id').primaryKey(),\n    name: text('name').notNull(),\n    maxConcurrency: integer('maxConcurrency'),\n    autoDispatch: bool('autoDispatch').notNull().default(true),\n  },\n);\n`,
    );
    const red = s.gate();
    assert.equal(red.status, 1, red.stdout + red.stderr);
    assert.match(red.stdout, /runner-device-field machine\.maxConcurrency/);
    assert.match(red.stdout, /runner-device-field machine\.autoDispatch/);
    s.registry([
      {
        type: 'runner-device-field',
        key: 'machine.maxConcurrency',
        userScenario: 'A new user meets it in the machine row when inspecting runner capacity.',
      },
      {
        type: 'runner-device-field',
        key: 'machine.autoDispatch',
        userScenario:
          'A new user meets it in the machine row when choosing whether work arrives automatically.',
      },
    ]);
    const green = s.gate();
    assert.equal(green.status, 0, green.stdout + green.stderr);
  });
});

test('a new settings key in a body schema is red without a registry row', () => {
  withSandbox((s) => {
    s.write(
      'packages/shared/src/records/team.ts',
      `import { z } from 'zod';\nexport const patchTeamBodySchema = z.object({\n  displayName: z.string().optional(),\n  ownerPreferredModel: z.string().optional(),\n});\n`,
    );
    const red = s.gate();
    assert.equal(red.status, 1, red.stdout + red.stderr);
    assert.match(red.stdout, /setting patchTeamBodySchema\.ownerPreferredModel/);
  });
});

test('a new nested settings key is red by path and green when registered', () => {
  withSandbox((s) => {
    const schema = (extra = '') =>
      `import { z } from 'zod';\nexport const patchTeamBodySchema = z\n  .object({\n    displayName: z.string().optional(),\n    nested: z.object({ inside: z.string()${extra} }).optional(),\n  })\n  .refine((body) => body.displayName !== undefined, { message: 'required' });\n`;
    s.write('packages/shared/src/records/team.ts', schema());
    s.commit('nested schema base');
    s.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    s.write(
      'packages/shared/src/records/team.ts',
      schema(',\n      inside2: z.string().optional()'),
    );
    const red = s.gate();
    assert.equal(red.status, 1, red.stdout + red.stderr);
    assert.match(red.stdout, /setting patchTeamBodySchema\.nested\.inside2/);
    s.registry([
      {
        type: 'setting',
        key: 'patchTeamBodySchema.nested.inside2',
        userScenario: 'A new user meets it inside the nested team settings form.',
      },
    ]);
    const green = s.gate();
    assert.equal(green.status, 0, green.stdout + green.stderr);
  });
});

test('prompt growth is red without the trailer and green with it', () => {
  withSandbox((s) => {
    s.write(
      'apps/server/src/services/chief.ts',
      'export const prompt = `short`;\nexport const extra = `growth`;\n',
    );
    s.commit('grow prompt');
    const red = s.gate();
    assert.equal(red.status, 1, red.stdout + red.stderr);
    assert.match(red.stdout, /prompt apps\/server\/src\/services\/chief\.ts/);
  });
  withSandbox((s) => {
    s.write(
      'apps/server/src/services/chief.ts',
      'export const prompt = `short`;\nexport const extra = `growth`;\n',
    );
    s.commit('grow prompt\n\nPrompt-growth: cover the empty remote-server state');
    const green = s.gate();
    assert.equal(green.status, 0, green.stdout + green.stderr);
  });
});

test('a clean diff is green and a malformed registry or missing base is fatal', () => {
  withSandbox((s) => {
    const green = s.gate();
    assert.equal(green.status, 0, green.stdout + green.stderr);
    assert.match(green.stdout, /PASS/);
    writeFileSync(join(s.dir, 'scripts/product-surface-registry.json'), '{bad json');
    const fatal = s.gate();
    assert.equal(fatal.status, 2);
    assert.match(fatal.stderr, /not valid JSON/);
  });
  withSandbox((s) => {
    s.git('update-ref', '-d', 'refs/remotes/origin/main');
    const missing = s.gate();
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /no merge-base/);
  });
});
