import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { poll, runCommand, spawnRecordedChild, stopChild } from './canary-process.mjs';

export function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

export async function startBridgeControl(port, host = '0.0.0.0') {
  const bridge = createServer((socket) => socket.destroy());
  try {
    await new Promise((ready, reject) => {
      bridge.once('error', reject);
      bridge.listen(port, host, ready);
    });
    await new Promise((ready, reject) => {
      const socket = connect({
        host: host === '0.0.0.0' ? '127.0.0.1' : host,
        port: bridge.address().port,
      });
      socket.setTimeout(2000, () => {
        socket.destroy();
        reject(new Error('Host listener positive control timed out'));
      });
      socket.once('error', reject);
      socket.once('connect', () => {
        socket.destroy();
        ready();
      });
    });
    return bridge;
  } catch (error) {
    bridge.close();
    throw error;
  }
}

export async function requireMatchingRelease({
  checkout = resolve(import.meta.dirname, '../../..'),
  releaseFile = '/var/lib/cairn-orb/dist/current.json',
  compute = async () =>
    JSON.parse(
      await runCommand(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          "import { orbDistRelease } from './src/orb/dist.ts'; import { runOrbCommand } from './src/orb/provider.ts'; console.log(JSON.stringify(await orbDistRelease('dist', runOrbCommand)));",
        ],
        { cwd: join(checkout, 'apps/daemon') },
      ),
    ),
} = {}) {
  const expected = await compute();
  const published = JSON.parse(readFileSync(releaseFile, 'utf8'));
  if (!expected.key || expected.key !== published.key) {
    const error = new Error(
      'CanaryReleaseMismatchError: checkout build must match the published Orb release; publish first',
    );
    error.name = 'CanaryReleaseMismatchError';
    throw error;
  }
  return expected;
}

export async function startStack({
  root,
  config,
  defer,
  signal,
  requireOrbBuild = true,
  probeNetwork = true,
  record,
}) {
  const checkout = resolve(import.meta.dirname, '../../..');
  if (typeof record !== 'function')
    throw new Error('Scratch stack requires a run manifest recorder');
  if (requireOrbBuild && !existsSync(join(checkout, 'apps/daemon/dist/cli.mjs')))
    throw new Error(
      'Matching daemon dist/cli.mjs is required; use the normally built Linux checkout',
    );
  if (requireOrbBuild) await requireMatchingRelease({ checkout });
  const port = await freePort();
  const modelPort = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const token = randomBytes(32).toString('hex');
  const home = join(root, 'os-home');
  mkdirSync(home);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    LANG: 'C.UTF-8',
    NODE_ENV: 'production',
    LOG_LEVEL: 'warn',
    CAIRN_TOKEN: token,
    CAIRN_SKILLS_DIR: join(root, 'skills'),
    CAIRN_MCP_CONFIG: join(root, 'mcp.json'),
    NO_PROXY: 'localhost,127.0.0.1,::1',
    no_proxy: 'localhost,127.0.0.1,::1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    CAIRN_ORB_RETAIN_RELEASES: '1',
    PNPM_CONFIG_IGNORE_SCRIPTS: 'true',
  };
  const api = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Scratch API ${method} ${path} failed (${response.status})`);
    return response.json();
  };
  const start = (directory, entry, args, extraEnv) => {
    const child = spawnRecordedChild(directory, entry, args, { ...env, ...extraEnv }, record);
    defer(() => stopChild(child, directory, entry));
    return child;
  };
  const server = start(join(checkout, 'apps/server'), 'src/index.ts', [], {
    CAIRN_HOME: join(root, 'server-home'),
    HOST: '127.0.0.1',
    PORT: String(port),
  });
  await poll(
    async () => {
      if (server.exitCode !== null || server.signalCode !== null)
        throw new Error('Scratch server exited before readiness');
      try {
        return await api('GET', '/api/teams');
      } catch {
        return false;
      }
    },
    { signal, timeout: 60000, label: 'scratch server' },
  );
  let controlPort = port;
  if (probeNetwork) {
    if (!config.tailnetAddress) throw new Error('Missing tailnet listener address');
    const listener = await startBridgeControl(0);
    defer(() => new Promise((closed) => listener.close(closed)));
    controlPort = listener.address().port;
    const socket = connect({ host: config.tailnetAddress, port: controlPort });
    await new Promise((ready, reject) => {
      socket.setTimeout(2000, () => {
        socket.destroy();
        reject(new Error('Host tailnet listener positive control timed out'));
      });
      socket.once('error', reject);
      socket.once('connect', () => {
        socket.destroy();
        ready();
      });
    });
  }
  const [team] = await api('GET', '/api/teams');
  const key = await api('POST', `/api/teams/${team.id}/api-keys`, {
    name: 'Orb canary',
    gitAccess: false,
    mcpAccess: false,
    machineAccess: true,
    toolGrants: { read: [], write: [] },
  });
  await api('POST', `/api/teams/${team.id}/providers`, {
    providerId: 'canary',
    label: 'Canary scripted model',
    baseUrl: `http://127.0.0.1:${modelPort}/v1`,
    api: 'openai-completions',
    apiKey: 'canary-fixture',
    models: [{ id: 'canary-model', name: 'Canary model' }],
  });
  return {
    port: controlPort,
    async run(executor) {
      const daemonHome = join(root, `${executor}-home`);
      const source = join(root, `${executor}-source`);
      const repo = join(root, `${executor}.git`);
      mkdirSync(join(source, '.agents'), { recursive: true });
      const gitEnv = {
        ...env,
        GIT_AUTHOR_NAME: 'Canary',
        GIT_AUTHOR_EMAIL: 'canary@example.invalid',
        GIT_COMMITTER_NAME: 'Canary',
        GIT_COMMITTER_EMAIL: 'canary@example.invalid',
      };
      const git = (args, cwd = source) => runCommand('git', args, { cwd, env: gitEnv, signal });
      await git(['init', '-b', 'main']);
      for (const name of ['canary-attacker.mjs', 'canary-model.mjs'])
        writeFileSync(
          join(source, '.agents', name),
          readFileSync(join(import.meta.dirname, name)),
          { flag: 'wx' },
        );
      writeFileSync(
        join(source, '.agents/config.json'),
        JSON.stringify({ ...config, serverPort: controlPort, modelPort, probeNetwork }),
        { flag: 'wx' },
      );
      writeFileSync(
        join(source, '.agents/setup'),
        '#!/bin/sh\nset -eu\nexec node .agents/canary-attacker.mjs .agents/config.json\n',
        { flag: 'wx', mode: 0o755 },
      );
      await git([
        'add',
        '.agents/setup',
        '.agents/config.json',
        '.agents/canary-attacker.mjs',
        '.agents/canary-model.mjs',
      ]);
      await git(['commit', '-m', 'Seed canary attacker']);
      await git(['clone', '--bare', source, repo]);
      const daemon = start(
        join(checkout, 'apps/daemon'),
        'src/cli.ts',
        ['start', '--foreground', '--server', base, '--name', `canary-${executor}`],
        {
          CAIRN_HOME: daemonHome,
          CAIRN_API_KEY: key.plaintext,
          CAIRN_TEAM: team.id,
          CAIRN_EXECUTOR: executor,
          CAIRN_HOOK_TIMEOUT_MS: '180000',
        },
      );
      const registration = await poll(
        () => {
          if (daemon.exitCode !== null || daemon.signalCode !== null)
            throw new Error('Scratch daemon exited before enrollment');
          try {
            return JSON.parse(readFileSync(join(daemonHome, 'machine.json'), 'utf8'));
          } catch {
            return false;
          }
        },
        { signal, timeout: 60000, label: 'non-interactive daemon enrollment' },
      );
      await stopChild(daemon, join(checkout, 'apps/daemon'), 'src/cli.ts');
      const agent = await api('POST', `/api/teams/${team.id}/agents`, {
        displayName: `Canary ${executor}`,
        provider: 'canary',
        modelId: 'canary-model',
        machineId: registration.machineId,
      });
      let project;
      for (let attempt = 0; attempt < 32; attempt++) {
        const candidate = await api('POST', '/api/projects', {
          teamId: team.id,
          name: `Canary ${executor}`,
          repoKind: 'local',
          localPath: repo,
        });
        if (/^[a-zA-Z0-9-]+$/.test(candidate.id)) {
          project = candidate;
          break;
        }
      }
      if (!project) throw new Error('Scratch Project ID did not satisfy the Orb provider contract');
      if (executor === 'orb') {
        const seed = join('/var/lib/cairn-orb/seed', project.id);
        if (lstatSync(seed, { throwIfNoEntry: false }))
          throw new Error('Scratch Project seed already exists; refusing to adopt it');
        record({ kind: 'seed', path: seed });
      }
      let buildId;
      for (let attempt = 0; attempt < 32; attempt++) {
        const task = await api('POST', `/api/projects/${project.id}/todos`, {
          title: 'Exercise secret isolation',
          spec: 'Let the setup hook run, then finish. The runner delivers the resulting files.',
        });
        const started = await api('POST', `/api/projects/${project.id}/builds`, {
          todoIds: [task.id],
          assignment: { plan: null, build: { agentId: agent.id } },
          withPlan: false,
        });
        const candidate = started.builds[0].id;
        const steps = await api('GET', `/api/builds/${candidate}/steps`);
        if (steps.length === 1 && /^[a-zA-Z0-9-]+$/.test(steps[0].id)) {
          buildId = candidate;
          break;
        }
        await api('POST', `/api/builds/${candidate}/stop`, { discard: true });
      }
      if (!buildId) throw new Error('Scratch step ID did not satisfy the Orb runner contract');
      const orbName = `cairn-orb-${buildId}`;
      if (executor === 'orb') {
        const images = await runCommand(
          'machinectl',
          ['--no-ask-password', 'list-images', '--no-legend', '--no-pager'],
          { signal },
        );
        if (
          images.split('\n').some((line) => line.trim().split(/\s+/)[0] === orbName) ||
          existsSync(join('/run/cairn-orb', orbName))
        )
          throw new Error('Scratch Orb machine already exists; refusing to adopt it');
      }
      if (executor === 'orb') record({ kind: 'machine', name: orbName });
      const branch = `cairn/conv-${buildId}`;
      const runnerDaemon = start(
        join(checkout, 'apps/daemon'),
        'src/cli.ts',
        ['start', '--foreground', '--server', base, '--name', `canary-${executor}`],
        { CAIRN_HOME: daemonHome, CAIRN_EXECUTOR: executor, CAIRN_HOOK_TIMEOUT_MS: '180000' },
      );
      await poll(
        async () => {
          if (runnerDaemon.exitCode !== null || runnerDaemon.signalCode !== null)
            throw new Error('Scratch daemon exited during the Thread');
          const steps = await api('GET', `/api/builds/${buildId}/steps`);
          const step = steps.find((entry) => entry.kind === 'build');
          if (step?.status === 'failed') throw new Error(`Scratch ${executor} runner failed`);
          return step?.status === 'done';
        },
        { signal, timeout: 600000, label: `${executor} runner delivery` },
      );
      const result = JSON.parse(await git(['show', `${branch}:canary-result.json`], repo));
      const messages = await api('GET', `/api/conversations/${buildId}/messages`);
      const hook = messages.messages.find((entry) =>
        entry.content.includes('CAIRN_CANARY_RESULT='),
      );
      const noteResult = hook?.content.split('CAIRN_CANARY_RESULT=')[1]?.split('\n')[0];
      if (!noteResult || JSON.stringify(JSON.parse(noteResult)) !== JSON.stringify(result))
        throw new Error('Delivered attacker result does not match the server hook note');
      await stopChild(runnerDaemon, join(checkout, 'apps/daemon'), 'src/cli.ts');
      return { repo, branch, result, orbName };
    },
  };
}
