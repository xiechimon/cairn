import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mock, test } from 'node:test';
import { promisify } from 'node:util';

const run = mock.fn();
const originalExecFile = childProcess.execFile;
childProcess.execFile = Object.assign(() => assert.fail('Expected promisified execFile'), {
  [promisify.custom]: run,
});
syncBuiltinESMExports();
const { signedLikeRunningApp } = await import('../src/signature.ts').finally(() => {
  childProcess.execFile = originalExecFile;
  syncBuiltinESMExports();
});

const RUNNING = '/fixtures/Running.app';
const STAGED = '/fixtures/Staged.app';
const VERIFY = ['--verify', '--strict'];
const PROBE_ARG = '-R=certificate leaf[subject.CN] exists';
const PROBE = [...VERIFY, PROBE_ARG, RUNNING];
const DISPLAY = ['-d', '-r-', RUNNING];
const REQUIREMENT =
  'identifier "io.github.xiechimon.cairn" and certificate root = H"0123456789012345678901234567890123456789"';
const DESIGNATED = `designated => ${REQUIREMENT}\n`;
const REQUIRED_CHECKS = [
  PROBE,
  DISPLAY,
  [...VERIFY, `-R=${REQUIREMENT}`, RUNNING],
  [...VERIFY, `-R=${REQUIREMENT}`, STAGED],
];
const STRICT_ONLY = [PROBE, [...VERIFY, STAGED]];
const ADHOC_DISPLAY = 'Signature=adhoc\n';
const CERTIFICATE_DISPLAY = 'Signature size=2146\nAuthority=Cairn Mac Self-Signed\n';
const UNSIGNED = `${RUNNING}: code object is not signed at all\n`;
const OK = { stdout: '', stderr: '' };

function failure(code, details = {}) {
  return Object.assign(new Error('codesign failed'), { ...OK, code, ...details });
}

async function decision({
  probe = OK,
  display = { stdout: DESIGNATED, stderr: CERTIFICATE_DISPLAY },
  running = OK,
  staged = OK,
} = {}) {
  run.mock.resetCalls();
  run.mock.mockImplementation(async (_file, args) => {
    const result = args.includes(PROBE_ARG)
      ? probe
      : args[0] === '-d'
        ? display
        : args.at(-1) === RUNNING
          ? running
          : staged;
    if (result instanceof Error) throw result;
    return result;
  });
  const accepted = await signedLikeRunningApp(RUNNING, STAGED);
  const calls = run.mock.calls.map(({ arguments: [file, args] }) => {
    assert.equal(file, '/usr/bin/codesign');
    return args;
  });
  return { accepted, calls };
}

test('exit 0 requires the full designated requirement on both bundles', async () => {
  assert.deepEqual(await decision(), { accepted: true, calls: REQUIRED_CHECKS });
  for (const result of [{ running: failure(3) }, { staged: failure(3) }]) {
    assert.deepEqual(await decision(result), { accepted: false, calls: REQUIRED_CHECKS });
  }
});

for (const [description, display] of [
  ['zero requirement lines', { stdout: '', stderr: CERTIFICATE_DISPLAY }],
  ['requirement on stderr only', { stdout: '', stderr: CERTIFICATE_DISPLAY + DESIGNATED }],
  [
    'two requirement lines',
    { stdout: `${DESIGNATED}designated => always\n`, stderr: CERTIFICATE_DISPLAY },
  ],
  ['malformed requirement line', { stdout: 'internal => always\n', stderr: CERTIFICATE_DISPLAY }],
  ['empty designated requirement', { stdout: 'designated =>    \n', stderr: CERTIFICATE_DISPLAY }],
  [
    'extra output beside the requirement',
    { stdout: `${DESIGNATED}extra\n`, stderr: CERTIFICATE_DISPLAY },
  ],
  ['failed requirement read with an unsigned diagnostic', failure(1, { stderr: UNSIGNED })],
]) {
  test(`exit 0 refuses ${description}`, async () => {
    assert.deepEqual(await decision({ display }), { accepted: false, calls: [PROBE, DISPLAY] });
  });
}

test('exit 3 uses strict verification only, without reading a display', async () => {
  assert.deepEqual(await decision({ probe: failure(3) }), { accepted: true, calls: STRICT_ONLY });
  assert.deepEqual(await decision({ probe: failure(3), staged: failure(1) }), {
    accepted: false,
    calls: STRICT_ONLY,
  });
});

test('exit 1 with the exact unsigned diagnostic keeps strict verification only', async () => {
  const probe = failure(1, { stderr: UNSIGNED });
  assert.deepEqual(await decision({ probe, display: probe }), {
    accepted: true,
    calls: STRICT_ONLY,
  });
  assert.deepEqual(await decision({ probe, display: probe, staged: failure(1) }), {
    accepted: false,
    calls: STRICT_ONLY,
  });
});

for (const [description, probe] of [
  ['exit 1 without the unsigned diagnostic', failure(1)],
  ['exit 1 with extra diagnostic text', failure(1, { stderr: `${UNSIGNED}other error\n` })],
  ['exit 1 with unexpected stdout', failure(1, { stdout: 'other output', stderr: UNSIGNED })],
  ['exit 2 for bad arguments', failure(2)],
  ['unexpected exit status', failure(4)],
  ['signal termination', failure(null, { signal: 'SIGKILL' })],
  ['timeout even with exit 3', failure(3, { killed: true })],
  ['spawn failure', failure('ENOENT')],
]) {
  test(`${description} refuses even if display text contains an ad-hoc marker`, async () => {
    assert.deepEqual(await decision({ probe, display: { stdout: '', stderr: ADHOC_DISPLAY } }), {
      accepted: false,
      calls: [PROBE],
    });
  });
}

test('display markers before, after, or across certificate lines cannot select the allowance', async () => {
  for (const stderr of [
    ADHOC_DISPLAY,
    ADHOC_DISPLAY + CERTIFICATE_DISPLAY,
    CERTIFICATE_DISPLAY + ADHOC_DISPLAY,
    ADHOC_DISPLAY + ADHOC_DISPLAY,
    CERTIFICATE_DISPLAY + CERTIFICATE_DISPLAY,
  ]) {
    assert.deepEqual(await decision({ display: { stdout: DESIGNATED, stderr } }), {
      accepted: true,
      calls: REQUIRED_CHECKS,
    });
  }
  assert.deepEqual(
    await decision({ display: { stdout: ADHOC_DISPLAY + DESIGNATED, stderr: ADHOC_DISPLAY } }),
    { accepted: false, calls: [PROBE, DISPLAY] },
  );
});
