import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import {
  assertSafeOutDir,
  createTargetClient,
  evaluateDeployAlignment,
  evaluateHealth,
  formatRemoteSshCommand,
  isProdLocalHost,
  langfuseObservationsPath,
  otlpTraceIdOfBuild,
  otlpTraceIdOfStep,
  otlpTraceIdOfTurn,
  parseAccessTokenContent,
  parseArgs,
  redactReport,
  runCli,
} from './agent-passage.mjs';

const tempDirs = [];

function makeTempDir(prefix = 'agent-passage-test-') {
  const dir = realpathSync(makeTestTempDir(prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    releaseTestTempDir(dir);
  }
});

test('parseArgs parses all subcommands and flags', () => {
  const health = parseArgs([
    'health',
    '--target',
    'prod',
    '--expect-sha',
    'abc1234',
    '--machine',
    'macmini',
    '--json',
  ]);
  assert.equal(health.command, 'health');
  assert.equal(health.target, 'prod');
  assert.equal(health.expectSha, 'abc1234');
  assert.equal(health.machine, 'macmini');
  assert.equal(health.json, true);

  const journey = parseArgs([
    'top-journeys',
    '--target=local',
    '--live',
    '--own-stack',
    '--out=/tmp/ev-out',
    '--timeout-ms=12000',
    '--todo',
    'todo-1',
    '--build',
    'build-1',
    '--step',
    'step-1',
    '--thread',
    'chief-thread-1',
    '--project',
    'proj-1',
  ]);
  assert.equal(journey.command, 'top-journeys');
  assert.equal(journey.target, 'local');
  assert.equal(journey.live, true);
  assert.equal(journey.ownStack, true);
  assert.equal(journey.outDir, '/tmp/ev-out');
  assert.equal(journey.timeoutMs, 12000);
  assert.equal(journey.todoId, 'todo-1');
  assert.equal(journey.buildId, 'build-1');
  assert.equal(journey.stepId, 'step-1');
  assert.equal(journey.threadId, 'chief-thread-1');
  assert.equal(journey.projectId, 'proj-1');
});

test('parseArgs rejects invalid commands, targets, and missing flag values', () => {
  assert.throws(() => parseArgs([]), /Missing command/);
  assert.throws(() => parseArgs(['unknown-cmd']), /Unknown command/);
  assert.throws(() => parseArgs(['health', '--target', 'staging']), /Invalid --target/);
  assert.throws(() => parseArgs(['health', '--expect-sha']), /requires a value/);
  assert.throws(() => parseArgs(['health', '--live=true']), /does not take a value/);
  assert.throws(() => parseArgs(['health', 'extra-arg']), /Unexpected arguments/);
});

test('OTel trace IDs match packages/shared/src/otel.ts derivation', () => {
  const expectedBuild = createHash('sha256')
    .update(JSON.stringify(['trace', 'build-42']))
    .digest('hex')
    .slice(0, 32);
  const expectedTurn = createHash('sha256')
    .update(JSON.stringify(['trace', 'turn', 'step-99']))
    .digest('hex')
    .slice(0, 32);

  assert.equal(otlpTraceIdOfBuild('build-42'), expectedBuild);
  assert.equal(otlpTraceIdOfTurn('step-99'), expectedTurn);
  assert.equal(
    otlpTraceIdOfStep({ kind: 'chief', buildId: 'chief-1', stepId: 'step-99' }),
    expectedTurn,
  );
  assert.equal(
    otlpTraceIdOfStep({ kind: 'build', buildId: 'build-42', stepId: 'step-99' }),
    expectedBuild,
  );
  assert.equal(
    langfuseObservationsPath(expectedBuild),
    `/api/public/v2/observations?traceId=${expectedBuild}&fields=core,basic,metadata,usage,model`,
  );
});

test('redactReport scrubs secret keys and token patterns recursively', () => {
  const redacted = redactReport({
    token: 'secret-token-value',
    nested: {
      authToken: 'raw-auth-secret',
      bearerLine: 'header was Bearer abcdefgh12345678 in log',
      cairnKey: 'created cairn_secretkeyvalue1234',
      ghKey: ['ghp', '1234567890abcdef'].join('_'),
      safe: 'normal diagnostic text',
    },
    list: [{ apiKey: 'my-api-key' }, 'Bearer xyz123456789'],
  });

  assert.equal(redacted.token, '[REDACTED]');
  assert.equal(redacted.nested.authToken, '[REDACTED]');
  assert.equal(redacted.nested.bearerLine, 'header was Bearer [REDACTED] in log');
  assert.equal(redacted.nested.cairnKey, 'created cairn_[REDACTED]');
  assert.equal(redacted.nested.ghKey, '[REDACTED_KEY]');
  assert.equal(redacted.nested.safe, 'normal diagnostic text');
  assert.equal(redacted.list[0].apiKey, '[REDACTED]');
  assert.equal(redacted.list[1], 'Bearer [REDACTED]');
});

test('assertSafeOutDir blocks docs/verify and allows external directories', () => {
  const fakeRepo = makeTempDir('agent-passage-repo-');
  assert.throws(
    () => assertSafeOutDir(join(fakeRepo, 'docs', 'verify', '123'), fakeRepo),
    /Refusing to write evidence inside/,
  );
  const allowed = assertSafeOutDir(join(fakeRepo, 'docs', 'verify-notes', 'run1'), fakeRepo);
  assert.equal(allowed, join(fakeRepo, 'docs', 'verify-notes', 'run1'));
});

test('evaluateDeployAlignment catches runner SHA mismatch and non-ancestor expect-sha', () => {
  const healthy = evaluateDeployAlignment({
    target: 'prod',
    expectSha: '111111111111',
    deploySha: '222222222222',
    deployRecordSha: '222222222222',
    versionCommit: '2222222',
    runnerSha: '222222222222',
    isAncestor: (anc, desc) => anc === '111111111111' && desc === '222222222222',
  });
  assert.equal(healthy.ok, true);

  const runnerMismatch = evaluateDeployAlignment({
    target: 'prod',
    expectSha: '111111111111',
    deploySha: '222222222222',
    deployRecordSha: '222222222222',
    versionCommit: '2222222',
    runnerSha: '999999999999',
    isAncestor: () => true,
  });
  assert.equal(runnerMismatch.ok, false);
  assert.match(
    runnerMismatch.errors.join('\n'),
    /cairn-runner HEAD .* does not match deployed SHA/,
  );

  const badAncestor = evaluateDeployAlignment({
    target: 'prod',
    expectSha: 'deadbeef0000',
    deploySha: '222222222222',
    deployRecordSha: '222222222222',
    versionCommit: '2222222',
    runnerSha: '222222222222',
    isAncestor: () => false,
  });
  assert.equal(badAncestor.ok, false);
  assert.match(badAncestor.errors.join('\n'), /not an ancestor/);
});

test('evaluateHealth detects Coordinator core tool drop and post-restart local Mac tool drop', () => {
  const baseDiag = {
    status: 200,
    data: {
      coordinator: {
        offeredToolCount: 12,
        offeredTools: ['create_todo', 'todos'],
        coreToolsPresent: true,
        missingCoreTools: [],
        ownComputerReady: true,
        ownComputerReason: null,
      },
      machines: [
        { id: 'mac-1', name: 'Mac mini', kind: 'local', online: true, hubConnected: true },
      ],
    },
  };

  const ok = evaluateHealth({
    target: 'prod',
    userMe: { status: 200, data: { id: 'u1', displayName: 'Owner' } },
    teams: { status: 200, data: [{ id: 'team-1' }] },
    diagnostics: baseDiag,
    machines: [{ id: 'mac-1', name: 'Mac mini', online: true }],
    deployAlignment: { ok: true, checks: [], errors: [] },
  });
  assert.equal(ok.ok, true);

  const toolDrop = evaluateHealth({
    target: 'prod',
    userMe: { status: 200, data: { id: 'u1', displayName: 'Owner' } },
    teams: { status: 200, data: [{ id: 'team-1' }] },
    diagnostics: {
      status: 200,
      data: {
        ...baseDiag.data,
        coordinator: {
          ...baseDiag.data.coordinator,
          coreToolsPresent: false,
          missingCoreTools: ['create_todo', 'todos'],
        },
      },
    },
    machines: [{ id: 'mac-1', name: 'Mac mini', online: true }],
    deployAlignment: { ok: true, checks: [], errors: [] },
  });
  assert.equal(toolDrop.ok, false);
  assert.match(toolDrop.errors.join('\n'), /Coordinator core tools missing: create_todo, todos/);

  const macDisconnected = evaluateHealth({
    target: 'prod',
    userMe: { status: 200, data: { id: 'u1', displayName: 'Owner' } },
    teams: { status: 200, data: [{ id: 'team-1' }] },
    diagnostics: {
      status: 200,
      data: {
        coordinator: {
          ...baseDiag.data.coordinator,
          ownComputerReady: false,
          ownComputerReason: 'No connected local Mac machine after runner restart',
        },
        machines: [
          {
            id: 'mac-1',
            name: 'Mac mini',
            kind: 'local',
            online: true,
            hubConnected: false,
            capabilities: { ownComputer: true, ownComputerShell: true },
          },
        ],
      },
    },
    machines: [{ id: 'mac-1', name: 'Mac mini', online: true }],
    deployAlignment: { ok: true, checks: [], errors: [] },
  });
  assert.equal(macDisconnected.ok, false);
  assert.match(
    macDisconnected.errors.join('\n'),
    /No connected local Mac machine after runner restart/,
  );

  const placeholderOnly = evaluateHealth({
    target: 'local',
    userMe: { status: 200, data: { id: 'u1', displayName: 'Owner' } },
    teams: { status: 200, data: [{ id: 'team-1' }] },
    diagnostics: {
      status: 200,
      data: {
        coordinator: {
          ...baseDiag.data.coordinator,
          ownComputerReady: false,
          ownComputerReason: 'no active Coordinator thread for team',
        },
        machines: [
          {
            id: 'mac-placeholder',
            name: 'Mac mini',
            kind: 'local',
            online: false,
            hubConnected: false,
            latestCliVersion: null,
            capabilities: { ownComputer: false, ownComputerShell: false },
          },
        ],
      },
    },
    machines: [{ id: 'mac-placeholder', name: 'Mac mini', kind: 'local', online: false }],
    deployAlignment: { ok: true, checks: [], errors: [] },
  });
  assert.equal(placeholderOnly.ok, true);

  const enrolledOffline = evaluateHealth({
    target: 'prod',
    userMe: { status: 200, data: { id: 'u1', displayName: 'Owner' } },
    teams: { status: 200, data: [{ id: 'team-1' }] },
    diagnostics: {
      status: 200,
      data: {
        coordinator: {
          ...baseDiag.data.coordinator,
          ownComputerReady: false,
          ownComputerReason: 'No connected local Mac machine',
        },
        machines: [
          {
            id: 'mac-enrolled',
            name: 'Mac mini',
            kind: 'local',
            online: false,
            hubConnected: false,
            latestCliVersion: '0.1.800',
            capabilities: { ownComputer: true, ownComputerShell: true },
          },
        ],
      },
    },
    machines: [{ id: 'mac-enrolled', name: 'Mac mini', kind: 'local', online: false }],
    deployAlignment: { ok: true, checks: [], errors: [] },
  });
  assert.equal(enrolledOffline.ok, false);
  assert.match(enrolledOffline.errors.join('\n'), /Own computer not ready/);

  const headlessOnline = evaluateHealth({
    target: 'prod',
    userMe: { status: 200, data: { id: 'u1', displayName: 'Owner' } },
    teams: { status: 200, data: [{ id: 'team-1' }] },
    diagnostics: {
      status: 200,
      data: {
        coordinator: {
          ...baseDiag.data.coordinator,
          ownComputerReady: false,
          ownComputerReason: 'No Mac with the Cairn app is connected',
        },
        machines: [
          {
            id: 'mac-headless',
            name: 'Ians-Mac-mini.local',
            kind: 'local',
            online: true,
            hubConnected: true,
            latestCliVersion: '0.2.3',
            capabilities: { ownComputer: false, ownComputerShell: false },
          },
        ],
      },
    },
    machines: [{ id: 'mac-headless', name: 'Ians-Mac-mini.local', kind: 'local', online: true }],
    deployAlignment: { ok: true, checks: [], errors: [] },
  });
  assert.equal(headlessOnline.ok, true);
  assert.equal(parseAccessTokenContent('# comment\nCAIRN_TOKEN="abc123def"\n'), 'abc123def');
  assert.equal(parseAccessTokenContent('baretokenvalue\n'), 'baretokenvalue');
});

test('createTargetClient prod mode invokes ssh BatchMode with shell-safe python3 scripts and zero token leakage', async () => {
  const sshCalls = [];
  const client = await createTargetClient(
    { target: 'prod' },
    {
      env: {},
      spawnFn: (cmd, args, opts) => {
        sshCalls.push({ cmd, args, input: opts.input });
        if (cmd === 'ssh') {
          const remoteCmd = args.at(-1) ?? '';
          assert.equal(remoteCmd.includes('\n'), false);
          if (remoteCmd.startsWith('python3 -c ')) {
            return {
              status: 0,
              stdout: JSON.stringify({
                status: 200,
                data: { id: 'u1', displayName: 'Owner' },
                text: '{}',
              }),
              stderr: '',
            };
          }
        }
        return { status: 0, stdout: JSON.stringify({ ok: true, rows: [] }), stderr: '' };
      },
    },
  );

  const res = await client.requestJson('GET', '/api/user/me');
  assert.equal(res.status, 200);
  assert.equal(sshCalls[0].cmd, 'ssh');
  assert.equal(sshCalls[0].args.includes('BatchMode=yes'), true);
  assert.equal(sshCalls[0].args.includes('macmini'), true);
  assert.equal(JSON.parse(sshCalls[0].input).token, undefined);

  const roundTripNode = formatRemoteSshCommand('node', [
    '-e',
    'const fs = require("node:fs"); console.log(JSON.stringify({ ok: Boolean(fs) }));',
  ]);
  const nodeOut = execFileSync('/bin/sh', ['-c', roundTripNode], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(nodeOut), { ok: true });

  const roundTripPy = formatRemoteSshCommand('python3', [
    '-c',
    'import json; print(json.dumps({"ok": True}))',
  ]);
  const pyOut = execFileSync('/bin/sh', ['-c', roundTripPy], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(pyOut), { ok: true });

  assert.equal(isProdLocalHost({ AGENT_PASSAGE_PROD_LOCAL: '1' }, 'laptop'), true);
  assert.equal(isProdLocalHost({}, 'macmini.local'), true);
  assert.equal(isProdLocalHost({}, 'MacBook-Pro.local'), false);
});

function createMockClient({
  target = 'local',
  coreToolsPresent = true,
  missingCoreTools = [],
  hubConnected = true,
  ownComputerReady = true,
  ownComputerReason = null,
  runnerSha = 'aaaabbbbccccdddd',
  deploySha = 'aaaabbbbccccdddd',
  stepStatus = 'done',
  failureCode = null,
  errorMessage = null,
  stepMachineId = 'machine-1',
} = {}) {
  const calls = [];
  let deletedTodo = false;
  let deletedProject = false;
  let buildCounter = 0;
  let lastPrompt = '[passage-probe] passage-1';

  return {
    calls,
    get deletedTodo() {
      return deletedTodo;
    },
    get deletedProject() {
      return deletedProject;
    },
    target,
    baseUrl: 'http://127.0.0.1:8791',
    async requestJson(method, path, body) {
      calls.push({ method, path, body });
      if (method === 'GET' && path === '/api/user/me') {
        return { status: 200, data: { id: 'owner-1', displayName: 'Owner' }, text: '{}' };
      }
      if (method === 'GET' && path === '/api/server/deploy') {
        return { status: 200, data: { deployed: { sha: deploySha } }, text: '{}' };
      }
      if (method === 'GET' && path === '/api/server/version') {
        return {
          status: 200,
          data: { version: '0.1.0', commit: deploySha.slice(0, 7), busy: false },
          text: '{}',
        };
      }
      if (method === 'GET' && path === '/api/teams') {
        return { status: 200, data: [{ id: 'team-1', name: 'Team' }], text: '[]' };
      }
      if (method === 'GET' && path === '/api/teams/team-1/machines') {
        return {
          status: 200,
          data: [{ id: 'machine-1', name: 'Mac mini', kind: 'local', online: true }],
          text: '[]',
        };
      }
      if (method === 'GET' && path === '/api/teams/team-1/chief/diagnostics') {
        return {
          status: 200,
          data: {
            threadId: 'chief-thread-1',
            coordinator: {
              offeredToolCount: coreToolsPresent ? 10 : 5,
              offeredTools: coreToolsPresent ? ['create_todo', 'todos'] : [],
              coreToolsPresent,
              missingCoreTools,
              ownComputerReady,
              ownComputerReason,
            },
            machines: [
              {
                id: 'machine-1',
                name: 'Mac mini',
                kind: 'local',
                online: true,
                hubConnected,
              },
            ],
            recentFailures:
              stepStatus === 'failed'
                ? [
                    {
                      stepId: 'step-1',
                      buildId: 'build-1',
                      kind: 'build',
                      status: 'failed',
                      failureCode,
                      errorMessage,
                      traceId: otlpTraceIdOfBuild('build-1'),
                    },
                  ]
                : [],
          },
          text: '{}',
        };
      }
      if (method === 'GET' && path.startsWith('/api/teams/team-1/chief/threads')) {
        return { status: 200, data: [{ id: 'chief-thread-1' }], text: '[]' };
      }
      if (method === 'GET' && path.startsWith('/api/teams/team-1/chief')) {
        return { status: 200, data: { chief: { id: 'chief-1' } }, text: '{}' };
      }
      if (method === 'GET' && path === '/api/projects') {
        return {
          status: 200,
          data: [{ id: 'proj-1', name: 'Demo', archivedAt: null }],
          text: '[]',
        };
      }
      if (method === 'POST' && path === '/api/projects') {
        return {
          status: 201,
          data: { id: 'proj-probe-1', name: body?.name ?? 'passage-probe', archivedAt: null },
          text: '{}',
        };
      }
      if (method === 'DELETE' && path.startsWith('/api/projects/')) {
        deletedProject = true;
        return { status: 204, data: null, text: '' };
      }
      if (method === 'POST' && path === '/api/teams/team-1/chief/threads') {
        lastPrompt = typeof body?.content === 'string' ? body.content : lastPrompt;
        return {
          status: 201,
          data: {
            thread: { id: 'chief-thread-1' },
            message: { id: 'cmsg-1', role: 'user', createdAt: 1000 },
          },
          text: '{}',
        };
      }
      if (method === 'GET' && path === '/api/todos?teamId=team-1') {
        const marker = /passage-\d+/.exec(lastPrompt)?.[0] ?? 'passage-1';
        return {
          status: 200,
          data: [
            {
              id: 'todo-probe-1',
              projectId: 'proj-1',
              title: `[passage-probe] ${marker}`,
              spec: lastPrompt,
              phase: 'todo',
              latestBuildId: null,
            },
          ],
          text: '[]',
        };
      }
      if (method === 'GET' && path === '/api/todos/todo-probe-1') {
        return {
          status: 200,
          data: {
            id: 'todo-probe-1',
            projectId: 'proj-1',
            title: '[passage-probe] passage-1',
            phase: 'todo',
            latestBuildId: null,
          },
          text: '{}',
        };
      }
      if (method === 'POST' && path === '/api/projects/proj-1/builds') {
        buildCounter += 1;
        return {
          status: 201,
          data: { builds: [{ id: `build-${buildCounter}` }] },
          text: '{}',
        };
      }
      if (method === 'GET' && path.startsWith('/api/builds/build-') && path.endsWith('/steps')) {
        return {
          status: 200,
          data: [
            {
              id: 'step-1',
              buildId: 'build-1',
              kind: 'build',
              machineId: stepMachineId,
              status: stepStatus,
              failureCode,
            },
          ],
          text: '[]',
        };
      }
      if (method === 'GET' && path === '/api/conversations/chief-thread-1/messages') {
        return {
          status: 200,
          data: {
            messages: [
              {
                id: 'cmsg-2',
                role: 'assistant',
                content: 'Completed todo-probe-1 with Bearer leaked_secret_token_12345',
                createdAt: 2000,
              },
            ],
          },
          text: '{}',
        };
      }
      if (method === 'DELETE' && path === '/api/todos/todo-probe-1') {
        deletedTodo = true;
        return { status: 204, data: null, text: '' };
      }
      return { status: 404, data: { error: `unhandled ${method} ${path}` }, text: '' };
    },
    queryDb(sql, params = []) {
      if (sql.includes('FROM chief_message WHERE id = ?')) {
        return {
          ok: true,
          rows: [{ id: params[0], threadId: 'chief-thread-1', role: 'user', createdAt: 1000 }],
        };
      }
      if (sql.includes('FROM todo WHERE id = ?')) {
        return {
          ok: true,
          rows: [{ id: params[0], title: '[passage-probe]', phase: 'todo', seqNum: 1 }],
        };
      }
      if (sql.includes('FROM build WHERE id = ?')) {
        return {
          ok: true,
          rows: [
            { id: params[0], todoId: 'todo-probe-1', failureCode, errorMessage, createdAt: 1500 },
          ],
        };
      }
      if (sql.includes('FROM step WHERE id = ?')) {
        return {
          ok: true,
          rows: [
            {
              id: params[0],
              buildId: 'build-1',
              kind: 'build',
              machineId: stepMachineId,
              status: stepStatus,
              failureCode,
              createdAt: 1500,
              finishedAt: 1800,
            },
          ],
        };
      }
      if (sql.includes('FROM step') && sql.includes("kind = 'chief'")) {
        return {
          ok: true,
          rows: [
            {
              id: 'chief-step-1',
              buildId: 'chief-thread-1',
              kind: 'chief',
              status: 'done',
              createdAt: 1100,
            },
          ],
        };
      }
      if (sql.includes('FROM step')) {
        return {
          ok: true,
          rows: [
            {
              stepId: 'step-1',
              buildId: 'build-1',
              kind: 'build',
              status: stepStatus,
              machineId: stepMachineId,
              failureCode,
              errorMessage,
              todoId: 'todo-probe-1',
            },
          ],
        };
      }
      if (sql.includes('FROM build')) {
        return {
          ok: true,
          rows: [
            { id: 'build-1', todoId: 'todo-probe-1', failureCode, errorMessage, createdAt: 1500 },
          ],
        };
      }
      return { ok: true, rows: [{ count: 1 }] };
    },
    readDeployArtifacts() {
      return {
        deployedShaFile: deploySha,
        deployJson: { sha: deploySha },
        runnerSha,
        localHeadSha: deploySha,
      };
    },
    tailLogs() {
      return {
        serverErr: 'err line with cairn_leak1234567890',
        serverOut: 'server started',
        daemonLog: 'daemon connected',
      };
    },
    isAncestor() {
      return true;
    },
    async cleanup() {},
  };
}

test('runCli top-journeys --live succeeds, cleans up probe todo, and writes redacted result.json', async () => {
  const outDir = makeTempDir('agent-passage-out-');
  const mockClient = createMockClient({ target: 'prod' });
  const { exitCode, report } = await runCli(
    [
      'top-journeys',
      '--target',
      'prod',
      '--live',
      '--expect-sha',
      'aaaabbbb',
      '--timeout-ms',
      '2000',
      '--out',
      outDir,
    ],
    { createClient: async () => mockClient },
  );

  assert.equal(exitCode, 0);
  assert.equal(report.ok, true);
  assert.deepEqual(
    report.stages.map((s) => s.stage),
    ['health', 'coordinator-task', 'computer-run', 'chat-result'],
  );
  assert.equal(mockClient.deletedTodo, true);
  assert.equal(mockClient.deletedProject, true);

  const written = JSON.parse(readFileSync(join(outDir, 'result.json'), 'utf8'));
  assert.equal(written.ok, true);
  assert.equal(existsSync(join(outDir, 'result.json')), true);
  assert.equal(written.stages[2].result.traceId, otlpTraceIdOfBuild('build-1'));
});

test('runCli top-journeys automatically runs diagnose on step failure and redacts logs', async () => {
  const outDir = makeTempDir('agent-passage-fail-');
  const mockClient = createMockClient({
    target: 'prod',
    stepStatus: 'failed',
    failureCode: 'execution_error',
    errorMessage: 'Runner exited with Bearer secret_should_redact_123',
  });

  const { exitCode, report } = await runCli(
    ['top-journeys', '--target', 'prod', '--live', '--timeout-ms', '2000', '--out', outDir],
    { createClient: async () => mockClient },
  );

  assert.equal(exitCode, 1);
  assert.equal(report.ok, false);
  assert.equal(mockClient.deletedTodo, true);
  assert.equal(mockClient.deletedProject, true);
  assert.ok(report.diagnosis);
  assert.equal(report.diagnosis.traceId, otlpTraceIdOfBuild('build-1'));
  assert.match(report.diagnosis.langfusePath, /\/api\/public\/v2\/observations\?traceId=/);
  assert.equal(report.diagnosis.logs.serverErr, 'err line with cairn_[REDACTED]');
  assert.equal(JSON.stringify(report).includes('secret_should_redact_123'), false);
});

test('runCli top-journeys triggers diagnose when Coordinator loses tools or runner mismatches SHA', async () => {
  const toolDropClient = createMockClient({
    target: 'prod',
    coreToolsPresent: false,
    missingCoreTools: ['create_todo'],
  });
  const res1 = await runCli(['top-journeys', '--target', 'prod'], {
    createClient: async () => toolDropClient,
  });
  assert.equal(res1.exitCode, 1);
  assert.equal(res1.report.stages[0].stage, 'health');
  assert.equal(res1.report.stages[0].ok, false);
  assert.equal(res1.report.diagnosis.coreToolsPresent, false);

  const shaMismatchClient = createMockClient({
    target: 'prod',
    deploySha: '1111222233334444',
    runnerSha: '9999888877776666',
  });
  const res2 = await runCli(['health', '--target', 'prod'], {
    createClient: async () => shaMismatchClient,
  });
  assert.equal(res2.exitCode, 1);
  assert.match(res2.report.errors.join('\n'), /cairn-runner HEAD/);
});
