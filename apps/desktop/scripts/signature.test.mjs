import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { promisify } from 'node:util';

const run = mock.fn();
const originalExecFile = childProcess.execFile;
childProcess.execFile = Object.assign(() => assert.fail('Expected promisified execFile'), {
  [promisify.custom]: run,
});
syncBuiltinESMExports();
const signature = await import('../src/signature.ts').finally(() => {
  childProcess.execFile = originalExecFile;
  syncBuiltinESMExports();
});
const { CAIRN_REQUIREMENT, verifyCairnSignature } = signature;

const STAGED = '/fixtures/Staged.app';
const VERIFY = ['--verify', '--strict'];
const ARGV = [...VERIFY, `-R=${CAIRN_REQUIREMENT}`, STAGED];
const OK = { stdout: '', stderr: '' };

function failure(code, details = {}) {
  return Object.assign(new Error('codesign failed'), { ...OK, code, ...details });
}

async function decision(result = OK) {
  run.mock.resetCalls();
  run.mock.mockImplementation(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const outcome = await verifyCairnSignature(STAGED);
  const calls = run.mock.calls.map(({ arguments: [file, args] }) => {
    assert.equal(file, '/usr/bin/codesign');
    return args;
  });
  return { outcome, calls };
}

test('the requirement names the committed certificate and the packaged bundle identifier', () => {
  const certificate = readFileSync(
    join(import.meta.dirname, '../signing/cairn-mac-self-signed.crt'),
    'utf8',
  );
  const fingerprint = new X509Certificate(certificate).fingerprint.replaceAll(':', '');
  const builder = readFileSync(join(import.meta.dirname, '../electron-builder.yml'), 'utf8');
  const bundleId = /^appId: (\S+)$/m.exec(builder)?.[1];
  assert.equal(
    CAIRN_REQUIREMENT,
    `identifier "${bundleId}" and certificate leaf = H"${fingerprint}"`,
  );
});

test('the staged app is verified once against the requirement', async () => {
  assert.deepEqual(await decision(), { outcome: 'accepted', calls: [ARGV] });
});

test('exit 3 refuses with a requirement mismatch', async () => {
  assert.deepEqual(await decision(failure(3)), { outcome: 'requirement-mismatch', calls: [ARGV] });
});

for (const [description, result] of [
  ['exit 1', failure(1)],
  ['signal termination', failure(null, { signal: 'SIGKILL' })],
  ['timeout', failure(null, { killed: true })],
  ['spawn failure', failure('ENOENT')],
]) {
  test(`${description} refuses with a verification failure`, async () => {
    assert.deepEqual(await decision(result), { outcome: 'verification-failed', calls: [ARGV] });
  });
}
