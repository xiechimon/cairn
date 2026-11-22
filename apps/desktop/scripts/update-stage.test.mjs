import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { updateLogPath } from '../src/update-log.ts';
import { recordStagingFailure, stageUpdate } from '../src/update-stage.ts';
import { isStagedBundleFor } from '../src/update-staging.ts';
import {
  emptyUpdateState,
  readUpdateState,
  stagedFor,
  writeUpdateState,
} from '../src/update-state.ts';
import { readBundleVersion } from '../src/update-swap.ts';

const RUNNING_VERSION = '0.1.535';
const STAGED_VERSION = '0.1.674';
const OFFERED_VERSION = '0.1.688';

function bundle(root, version) {
  const app = join(root, 'Cairn.app');
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  const executable = join(app, 'Contents', 'MacOS', 'Cairn');
  writeFileSync(executable, `#!/bin/sh\necho ${version}\n`);
  chmodSync(executable, 0o755);
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>
`,
  );
  return app;
}

function zipOf(root, version) {
  const source = join(root, `zip-${version}`);
  mkdirSync(source, { recursive: true });
  bundle(source, version);
  const zip = join(root, `Cairn-${version}.zip`);
  execFileSync('/usr/bin/ditto', ['-c', '-k', source, zip]);
  return zip;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function serve(answer) {
  return new Promise((listening) => {
    const server = createServer((request, response) => {
      const { status, body } = answer(request.url ?? '');
      response.writeHead(status, { 'content-length': body.byteLength });
      response.end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      listening({
        url: `http://127.0.0.1:${server.address().port}/Cairn-${OFFERED_VERSION}.zip`,
        close: () => new Promise((closed) => server.close(() => closed())),
      });
    });
  });
}

function checkout() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-update-stage-')));
  const applications = join(root, 'Applications');
  mkdirSync(applications, { recursive: true });
  const running = bundle(applications, RUNNING_VERSION);
  const stagedFolder = join(applications, `.cairn-update-${STAGED_VERSION}`);
  mkdirSync(stagedFolder, { recursive: true });
  const stagedApp = bundle(stagedFolder, STAGED_VERSION);
  const zip = join(stagedFolder, `Cairn-${STAGED_VERSION}.zip`);
  writeFileSync(zip, 'the staged download');
  const statePath = join(root, 'userData', 'update-state.json');
  const state = {
    ...emptyUpdateState(),
    staged: {
      version: STAGED_VERSION,
      zip,
      app: stagedApp,
      previousVersion: RUNNING_VERSION,
      at: 1,
    },
    blocked: { version: '0.1.670', at: 1, reason: 'the server exited with code 1', attempts: 1 },
  };
  writeUpdateState(statePath, state);
  return {
    root,
    applications,
    bundle: running,
    userData: dirname(statePath),
    statePath,
    stagedApp,
    stagedFolder,
    state,
  };
}

function stagingFolders(applications) {
  return readdirSync(applications)
    .filter((name) => name.startsWith('.cairn-update-'))
    .sort();
}

function request(ctx, server, bytes, sha256 = digest(bytes)) {
  return {
    statePath: ctx.statePath,
    bundleFolder: ctx.applications,
    runningVersion: RUNNING_VERSION,
    update: {
      version: OFFERED_VERSION,
      url: server.url,
      size: bytes.byteLength,
      sha256,
    },
    onProgress: () => {},
  };
}

test('a strictly newer release replaces the staged one and the old folder goes', async () => {
  const ctx = checkout();
  const bytes = readFileSync(zipOf(ctx.root, OFFERED_VERSION));
  const server = await serve(() => ({ status: 200, body: bytes }));
  try {
    const staged = await stageUpdate(request(ctx, server, bytes));
    assert.equal(staged.version, OFFERED_VERSION);
    assert.equal(await readBundleVersion(staged.app), OFFERED_VERSION);
    const state = readUpdateState(ctx.statePath);
    assert.equal(state.staged?.version, OFFERED_VERSION);
    assert.equal(state.staged?.app, staged.app);
    assert.equal(state.staged?.previousVersion, RUNNING_VERSION);
    assert.deepEqual(state.blocked, ctx.state.blocked, 'a supersede keeps the blocked record');
    assert.equal(existsSync(ctx.stagedFolder), false, 'the superseded bundle is removed');
    assert.deepEqual(stagingFolders(ctx.applications), [basename(dirname(staged.app))]);
  } finally {
    await server.close();
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('the old bundle stays staged until the new one is verified', async () => {
  const ctx = checkout();
  const bytes = readFileSync(zipOf(ctx.root, OFFERED_VERSION));
  const server = await serve(() => ({ status: 200, body: bytes }));
  const observed = [];
  try {
    await stageUpdate({
      ...request(ctx, server, bytes),
      onProgress: () =>
        observed.push({
          version: readUpdateState(ctx.statePath).staged?.version,
          oldAppExists: existsSync(ctx.stagedApp),
        }),
    });
    assert.ok(observed.length > 0, 'the staging reported progress');
    for (const seen of observed) {
      assert.equal(seen.version, STAGED_VERSION, 'the switch happens after the last progress step');
      assert.equal(
        seen.oldAppExists,
        true,
        'the old bundle is on disk while the new one downloads',
      );
    }
  } finally {
    await server.close();
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('a download that fails leaves the staged bundle and its folder in place', async () => {
  const ctx = checkout();
  const body = Buffer.from('no');
  const server = await serve(() => ({ status: 500, body }));
  try {
    await assert.rejects(stageUpdate(request(ctx, server, body)), /download failed with HTTP 500/);
    assert.deepEqual(readUpdateState(ctx.statePath), ctx.state);
    assert.equal(await readBundleVersion(ctx.stagedApp), STAGED_VERSION);
    assert.deepEqual(stagingFolders(ctx.applications), [`.cairn-update-${STAGED_VERSION}`]);
  } finally {
    await server.close();
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('a download that does not match its digest leaves the staged bundle in place', async () => {
  const ctx = checkout();
  const bytes = readFileSync(zipOf(ctx.root, OFFERED_VERSION));
  const server = await serve(() => ({ status: 200, body: bytes }));
  try {
    await assert.rejects(stageUpdate(request(ctx, server, bytes, 'a'.repeat(64))), /SHA-256/);
    assert.deepEqual(readUpdateState(ctx.statePath), ctx.state);
    assert.equal(await readBundleVersion(ctx.stagedApp), STAGED_VERSION);
    assert.deepEqual(stagingFolders(ctx.applications), [`.cairn-update-${STAGED_VERSION}`]);
  } finally {
    await server.close();
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('a downloaded app of the wrong version leaves the staged bundle in place', async () => {
  const ctx = checkout();
  const bytes = readFileSync(zipOf(ctx.root, '0.1.500'));
  const server = await serve(() => ({ status: 200, body: bytes }));
  try {
    await assert.rejects(
      stageUpdate(request(ctx, server, bytes)),
      /the downloaded app is version 0.1.500, not 0.1.688/,
    );
    assert.deepEqual(readUpdateState(ctx.statePath), ctx.state);
    assert.equal(await readBundleVersion(ctx.stagedApp), STAGED_VERSION);
    assert.deepEqual(stagingFolders(ctx.applications), [`.cairn-update-${STAGED_VERSION}`]);
  } finally {
    await server.close();
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('a quit during staging applies the complete staged bundle, not the half-written one', async () => {
  const ctx = checkout();
  const interrupted = join(ctx.applications, '.cairn-update-interrupted');
  mkdirSync(interrupted, { recursive: true });
  writeFileSync(join(interrupted, `Cairn-${OFFERED_VERSION}.zip`), 'half a download');
  try {
    const staged = stagedFor(readUpdateState(ctx.statePath), RUNNING_VERSION);
    assert.equal(staged?.version, STAGED_VERSION);
    assert.equal(isStagedBundleFor(ctx.bundle, staged.app), true);
    assert.equal(await readBundleVersion(staged.app), STAGED_VERSION);
    assert.notEqual(staged.app, join(interrupted, 'Cairn.app'));
  } finally {
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

function logLines(userData) {
  return readFileSync(updateLogPath(userData), 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => line.replace(/^\S+ /, ''));
}

test('a failed replacement records the offer, the kept version and the reason', async () => {
  const ctx = checkout();
  const bytes = readFileSync(zipOf(ctx.root, OFFERED_VERSION));
  const server = await serve(() => ({ status: 200, body: bytes }));
  try {
    const staging = request(ctx, server, bytes, 'a'.repeat(64));
    const error = await stageUpdate(staging).then(
      () => null,
      (thrown) => thrown,
    );
    assert.ok(error instanceof Error, 'the staging failed');
    const published = recordStagingFailure({
      userData: ctx.userData,
      statePath: ctx.statePath,
      runningVersion: RUNNING_VERSION,
      update: staging.update,
      message: error.message,
    });
    assert.deepEqual(published, { status: 'ready', version: STAGED_VERSION });
    assert.deepEqual(logLines(ctx.userData), [
      'staging 0.1.688 failed, kept 0.1.674: the download does not match its SHA-256 digest',
    ]);
  } finally {
    await server.close();
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

test('a first staging failure records the offer and the reason with nothing kept', async () => {
  const ctx = checkout();
  writeUpdateState(ctx.statePath, emptyUpdateState());
  const body = Buffer.from('no');
  const server = await serve(() => ({ status: 500, body }));
  try {
    const staging = request(ctx, server, body);
    const error = await stageUpdate(staging).then(
      () => null,
      (thrown) => thrown,
    );
    assert.ok(error instanceof Error, 'the staging failed');
    const published = recordStagingFailure({
      userData: ctx.userData,
      statePath: ctx.statePath,
      runningVersion: RUNNING_VERSION,
      update: staging.update,
      message: error.message,
    });
    assert.deepEqual(published, { status: 'error', message: 'download failed with HTTP 500' });
    assert.deepEqual(logLines(ctx.userData), [
      'staging 0.1.688 failed: download failed with HTTP 500',
    ]);
  } finally {
    await server.close();
    rmSync(ctx.root, { recursive: true, force: true });
  }
});
