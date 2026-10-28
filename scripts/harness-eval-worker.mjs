import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import {
  compareFilesFromResponse,
  computePatchDigest,
} from '../apps/server/src/services/merge-gate/digest.ts';
import { harnessRegressionResultSchema } from '../packages/shared/src/records/merge-gate.ts';

export async function verifyBillingRoute({ url, key }, request = fetch) {
  try {
    const relay = new URL(url);
    if (
      !key ||
      !['http:', 'https:'].includes(relay.protocol) ||
      relay.username ||
      relay.password ||
      relay.search ||
      relay.hash
    )
      throw new Error();
    const response = await request(`${url.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error();
    const body = await response.json();
    if (!Array.isArray(body.data) || !body.data.some((model) => model.id === 'glm-5.3'))
      throw new Error();
    return {
      backend: 'pi',
      provider: 'relay-186',
      api: 'openai-completions',
      model: 'glm-5.3',
      routeReachable: true,
      dailyCap: 'owner-waived-1975-2026-10-27',
    };
  } catch {
    throw new Error('Billing route verification failed; no evaluation was started');
  }
}

function packageDir(manifest) {
  const dir = dirname(manifest);
  return dir === '.' ? '' : dir;
}

export function workspaceDependencyTargets({
  trustedRoot,
  dependencyManifests,
  workspaceManifests,
}) {
  const targets = new Map();
  for (const manifest of dependencyManifests) {
    const dir = packageDir(manifest);
    if (dir === '') continue;
    const nodeModules = join(trustedRoot, dir, 'node_modules');
    if (!existsSync(nodeModules)) continue;
    const names = [];
    for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) names.push(entry.name);
      else if (entry.isDirectory() && entry.name.startsWith('@'))
        for (const scoped of readdirSync(join(nodeModules, entry.name), { withFileTypes: true }))
          if (scoped.isSymbolicLink()) names.push(join(entry.name, scoped.name));
    }
    for (const name of names) {
      const resolved = realpathSync(join(nodeModules, name));
      if (!workspaceManifests.includes(join(relative(trustedRoot, resolved), 'package.json')))
        continue;
      targets.set(join(dir, 'node_modules', name), {
        resolved,
        link: readlinkSync(join(nodeModules, name)),
      });
    }
  }
  return targets;
}

export function linkWorkspaceDependencies({
  trustedRoot,
  checkout,
  manifests,
  dependencyManifests,
}) {
  const targets = workspaceDependencyTargets({
    trustedRoot,
    dependencyManifests,
    workspaceManifests: manifests,
  });
  const recreated = [];
  for (const [relPath, { resolved, link }] of targets) {
    const target = join(checkout, relPath);
    const current = lstatSync(target, { throwIfNoEntry: false });
    if (current) rmSync(target, { force: true });
    mkdirSync(dirname(target), { recursive: true });
    const dest = join(checkout, relative(trustedRoot, resolved));
    symlinkSync(dest, target, 'dir');
    recreated.push({ target, link });
  }
  return { targets, recreated };
}

export function restoreWorkspaceLinks(recreated) {
  for (const { target, link } of recreated) {
    if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) rmSync(target);
    symlinkSync(link, target, 'dir');
  }
}

export function linkDependencies({ trustedRoot, checkout, scratch, dependencyManifests }) {
  const links = [];
  for (const manifest of dependencyManifests) {
    const dir = packageDir(manifest);
    const source = join(trustedRoot, dir, 'node_modules');
    const target = join(checkout, dir, 'node_modules');
    if (!existsSync(source) || !existsSync(dirname(target))) continue;
    const dependencyCopy = join(scratch, 'dependencies', dir, 'node_modules');
    mkdirSync(dirname(dependencyCopy), { recursive: true });
    cpSync(source, dependencyCopy, { recursive: true, verbatimSymlinks: true });
    symlinkSync(dependencyCopy, target, 'dir');
    links.push({ source: dependencyCopy, target });
  }
  return links;
}

const publishedVariables = ['PATH', 'TMPDIR', 'TZ', 'LANG', 'LC_ALL', 'CAIRN_EVAL_RELAY_URL'];
const credentialFreeVariables = [
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
];

export function isolatedEvalEnv({ home, ghConfigDir, gitConfig, base = {} }) {
  const env = {};
  for (const name of publishedVariables) {
    if (base[name] !== undefined) env[name] = base[name];
  }
  for (const name of credentialFreeVariables) {
    if (base[name] !== undefined) env[name] = base[name];
  }
  env.CAIRN_EVAL_RELAY_KEY = base.CAIRN_EVAL_RELAY_KEY ?? '';
  env.CAIRN_PROBE_MARKER = base.CAIRN_PROBE_MARKER ?? '';
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.GH_CONFIG_DIR = ghConfigDir;
  env.GIT_CONFIG_GLOBAL = gitConfig;
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.SSH_AUTH_SOCK = '';
  return env;
}

export function runIsolatedEvaluation({ checkout, scratch, args, env, stdio = 'inherit' }) {
  const mounts = ['/usr', '/bin', '/lib', '/lib64', '/etc/ssl', '/etc/resolv.conf', '/etc/hosts']
    .filter((path) => existsSync(path))
    .flatMap((path) => ['--ro-bind', path, path]);
  execFileSync(
    'bwrap',
    [
      '--die-with-parent',
      '--new-session',
      '--unshare-user',
      '--unshare-pid',
      '--unshare-ipc',
      '--unshare-uts',
      '--cap-drop',
      'ALL',
      ...mounts,
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--tmpfs',
      '/tmp',
      '--ro-bind',
      process.execPath,
      '/runtime/node',
      '--bind',
      checkout,
      checkout,
      '--bind',
      scratch,
      scratch,
      ...(existsSync(join(checkout, '.git'))
        ? ['--ro-bind', join(checkout, '.git'), join(checkout, '.git')]
        : []),
      '--chdir',
      checkout,
      '--',
      '/runtime/node',
      ...args,
    ],
    { env: { ...env, PATH: '/runtime:/usr/bin:/bin' }, stdio },
  );
}

export async function publishEvaluation(request, dependencies) {
  if (!/^[1-9]\d*$/.test(request.ticket)) throw new Error('Invalid ticket');
  if (!/^[1-9]\d*$/.test(request.pr)) throw new Error('Invalid PR');
  if (!/^[\w.-]+\/[\w.-]+$/.test(request.repo)) throw new Error('Invalid repository');
  if (!/^[0-9a-f]{40}$/.test(request.expectedHead)) throw new Error('Invalid expected head');
  if (!/^pd2:[0-9a-f]{64}$/.test(request.patchDigest)) throw new Error('Invalid patch digest');
  const verified = await dependencies.verifyRequest(request);
  if (verified.head !== request.expectedHead) throw new Error('PR head changed');
  if (verified.patchDigest !== request.patchDigest) throw new Error('Patch digest mismatch');
  const branch = verified.branch;
  if (!branch || branch.startsWith('-')) throw new Error('Invalid branch');
  const root = mkdtempSync(join(dependencies.tempRoot ?? tmpdir(), 'cairn-harness-worker-'));
  const checkout = join(root, 'checkout');
  const git = (...args) => {
    dependencies.observe?.(args);
    return execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.fsmonitor=false',
        '-C',
        checkout,
        ...args,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 32 * 1024 * 1024,
      },
    ).trimEnd();
  };
  const outputPath = `docs/verify/${request.ticket}/harness-regression.json`;
  try {
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        'clone',
        '--no-checkout',
        '--no-local',
        '--',
        dependencies.remote,
        checkout,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    git('check-ref-format', `refs/heads/${branch}`);
    const remoteHead = () =>
      git('ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`).split(/\s/)[0];
    if (remoteHead() !== request.expectedHead) throw new Error('Remote head changed');
    git('checkout', '--detach', request.expectedHead);
    if (git('status', '--porcelain=v1', '--untracked-files=all') !== '')
      throw new Error('Checkout is dirty');
    await dependencies.evaluate({ checkout, output: join(checkout, outputPath), request });
    if (git('rev-parse', 'HEAD') !== request.expectedHead)
      throw new Error('Evaluation created additional commits');
    const status = git(
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--ignored=matching',
    );
    const entries = status.split('\0').filter(Boolean);
    if (
      entries.length !== 1 ||
      !['??', ' M', 'M ', 'MM'].includes(entries[0].slice(0, 2)) ||
      entries[0].slice(3) !== outputPath
    ) {
      throw new Error('Evaluation must modify only the requested result');
    }
    const output = join(checkout, outputPath);
    for (const part of ['docs', 'docs/verify', `docs/verify/${request.ticket}`, outputPath]) {
      const stat = lstatSync(join(checkout, part));
      if (stat.isSymbolicLink()) throw new Error('Result path must not contain symlinks');
    }
    if (!lstatSync(output).isFile()) throw new Error('Result must be a regular file');
    const result = harnessRegressionResultSchema.parse(JSON.parse(readFileSync(output, 'utf8')));
    if (result.patchDigest !== request.patchDigest) throw new Error('Result digest mismatch');
    git('add', '--', outputPath);
    const staged = git('diff', '--cached', '--name-status', '--no-renames');
    if (staged !== `A\t${outputPath}` && staged !== `M\t${outputPath}`)
      throw new Error('Invalid staged result diff');
    if (!dependencies.author?.name || !dependencies.author?.email)
      throw new Error('Missing publication author');
    git(
      '-c',
      `user.name=${dependencies.author.name}`,
      '-c',
      `user.email=${dependencies.author.email}`,
      'commit',
      '-m',
      `docs(${request.ticket}): publish harness regression result`,
    );
    const commit = git('rev-parse', 'HEAD');
    if (
      git('rev-list', '--count', `${request.expectedHead}..${commit}`) !== '1' ||
      git('rev-parse', `${commit}^`) !== request.expectedHead
    )
      throw new Error('Expected exactly one result commit');
    const completeDiff = git('diff', '--name-status', '--no-renames', request.expectedHead, commit);
    if (completeDiff !== `A\t${outputPath}` && completeDiff !== `M\t${outputPath}`)
      throw new Error('Commit contains unauthorized changes');
    if (remoteHead() !== request.expectedHead)
      throw new Error('Remote head changed before publication');
    git('push', 'origin', `${commit}:refs/heads/${branch}`);
    return { commit, branch, result };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const args = new Map();
    const allowed = new Set(['--repo', '--pr', '--ticket', '--expected-head', '--patch-digest']);
    for (let i = 2; i < process.argv.length; i += 2) {
      const flag = process.argv[i];
      const value = process.argv[i + 1];
      if (!allowed.has(flag) || !value || args.has(flag))
        throw new Error('Expected --repo --pr --ticket --expected-head --patch-digest');
      args.set(flag, value);
    }
    if (args.size !== allowed.size) throw new Error('Missing required worker input');
    if (hostname() !== 'omarchy') throw new Error('Evaluation must run on omarchy');
    const trustedRoot = resolve(import.meta.dirname, '..');
    if (!existsSync(join(trustedRoot, 'integration/test/write-verify.test.ts')))
      throw new Error(
        'Blocked: #1973 hardened evidence CLI and its acceptance tests are required before enabling evaluation',
      );
    if (!process.env.CAIRN_EVAL_RELAY_URL || !process.env.CAIRN_EVAL_RELAY_KEY)
      throw new Error('Explicit pi relay environment is required; credential fallback is disabled');
    const relay = new URL(process.env.CAIRN_EVAL_RELAY_URL);
    if (
      !['http:', 'https:'].includes(relay.protocol) ||
      relay.username ||
      relay.password ||
      relay.search ||
      relay.hash
    )
      throw new Error('Invalid pi relay URL');
    const request = {
      repo: args.get('--repo'),
      pr: args.get('--pr'),
      ticket: args.get('--ticket'),
      expectedHead: args.get('--expected-head'),
      patchDigest: args.get('--patch-digest'),
    };
    const api = (path) =>
      JSON.parse(
        execFileSync('gh', ['api', path], {
          cwd: trustedRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          maxBuffer: 32 * 1024 * 1024,
        }),
      );
    const published = await publishEvaluation(request, {
      remote: `https://github.com/${request.repo}.git`,
      author: { name: 'Cairn Eval Worker', email: 'cairn-eval@users.noreply.github.com' },
      verifyRequest: () => {
        const pr = api(`repos/${request.repo}/pulls/${request.pr}`);
        if (
          pr.state !== 'open' ||
          pr.head?.repo?.full_name !== request.repo ||
          pr.base?.repo?.full_name !== request.repo
        )
          throw new Error('Only open same-repository PRs are eligible');
        const compare = api(`repos/${request.repo}/compare/${pr.base.sha}...${pr.head.sha}`);
        const files = compareFilesFromResponse(compare);
        if (files === null) throw new Error('Invalid compare response');
        const computed = computePatchDigest(files, { expectedFileCount: pr.changed_files });
        return { head: pr.head.sha, branch: pr.head.ref, patchDigest: computed.patchDigest };
      },
      evaluate: async ({ checkout, output, request: input }) => {
        const links = [];
        const scratch = mkdtempSync(join(tmpdir(), 'cairn-harness-flow-'));
        try {
          const manifests = execFileSync(
            'git',
            ['-C', trustedRoot, 'ls-files', '-z', '**/package.json', 'package.json'],
            { encoding: 'utf8' },
          )
            .split('\0')
            .filter(Boolean);
          const dependencyManifests = manifests;
          links.push(...linkDependencies({ trustedRoot, checkout, scratch, dependencyManifests }));
          const { recreated } = linkWorkspaceDependencies({
            trustedRoot,
            checkout,
            scratch,
            manifests,
            dependencyManifests,
          });
          const flow = join(scratch, 'flow');
          const envHome = join(scratch, 'home');
          const envGh = join(scratch, 'gh');
          const envGitConfig = join(scratch, 'gitconfig');
          mkdirSync(envHome);
          mkdirSync(envGh);
          writeFileSync(envGitConfig, '');
          cpSync(join(checkout, '.claude/hillclimb/chief-dispatch'), flow, {
            recursive: true,
            filter: (path) =>
              !['baseline', 'traces'].includes(path.split('/').at(-1)) &&
              !/^v[1-9]\d*$/.test(path.split('/').at(-1)),
          });
          const route = await verifyBillingRoute({
            url: process.env.CAIRN_EVAL_RELAY_URL,
            key: process.env.CAIRN_EVAL_RELAY_KEY,
          });
          console.log(JSON.stringify({ billingRoute: route }));
          runIsolatedEvaluation({
            checkout,
            scratch,
            args: [
              '--import',
              join(checkout, 'integration/node_modules/tsx/dist/loader.mjs'),
              'integration/eval/chief-dispatch/run-eval.mts',
              '--flow',
              flow,
              '--variant',
              'baseline',
              '--model',
              'glm-5.3',
              '--reps',
              '3',
              '--approve-harness',
              '--write-verify',
              output,
              '--patch-digest',
              input.patchDigest,
            ],
            env: isolatedEvalEnv({
              home: envHome,
              ghConfigDir: envGh,
              gitConfig: envGitConfig,
              base: process.env,
            }),
          });
          for (const { source, target } of links) {
            if (!lstatSync(target).isSymbolicLink() || readlinkSync(target) !== source)
              throw new Error('Evaluation changed a dependency link');
          }
          restoreWorkspaceLinks(recreated);
        } finally {
          for (const { target } of links) {
            if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) rmSync(target);
          }
          rmSync(scratch, { recursive: true, force: true });
        }
      },
    });
    console.log(
      JSON.stringify({
        commit: published.commit,
        branch: published.branch,
        route: 'pi/relay-186/openai-completions/glm-5.3',
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
