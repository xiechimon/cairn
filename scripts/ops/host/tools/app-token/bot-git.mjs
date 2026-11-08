import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

const here = dirname(realpathSync(import.meta.filename));
const { githubNoreplyEmail, policyBotIdentity, publishVerifiedCommits } = await import(
  join(here, 'commit-identity.ts')
);
const policy = JSON.parse(readFileSync(join(here, 'commit-identity.json'), 'utf8'));

export const bot = policyBotIdentity(policy);
export const owner = {
  name: policy.owner.login,
  email: githubNoreplyEmail(policy.owner),
};

function splitDirectory(args) {
  const prefix = [];
  let rest = args;
  while (rest[0] === '-C' && rest.length > 1) {
    prefix.push('-C', rest[1]);
    rest = rest.slice(2);
  }
  return { prefix, rest };
}

function gitRunner(prefix) {
  return async (args) => {
    const result = spawnSync('git', [...prefix, ...args], { encoding: 'utf8' });
    if (result.status !== 0)
      throw new Error(`git ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
    return result.stdout.trim();
  };
}

export function parseCoAuthor(line) {
  if (!line) return null;
  const match = /^Co-authored-by: (.+) <([^<>\s]+)>$/.exec(line.trim());
  if (!match) throw new Error(`CAIRN_COAUTHOR is not a Co-authored-by trailer: ${line}`);
  return { name: match[1], email: match[2] };
}

export function pushTarget(pushArgs) {
  const remoteAt = pushArgs.indexOf('origin');
  const refspec = remoteAt === -1 ? undefined : pushArgs[remoteAt + 1];
  if (!refspec || pushArgs.length !== remoteAt + 2)
    throw new Error('bot-git push needs exactly: [flags] origin <src>[:<branch>]');
  const [src, dst = src] = refspec.split(':');
  if (!src || !dst) throw new Error(`unsupported refspec ${refspec}`);
  return { src, branch: dst.replace(/^refs\/heads\//, '') };
}

function repository(url) {
  const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!match) throw new Error(`origin is not a GitHub repository: ${url}`);
  return `${match[1]}/${match[2]}`;
}

function apiFor(git, token) {
  const base = process.env.CAIRN_GITHUB_API_URL ?? 'https://api.github.com';
  let repo = null;
  return async (method, path, body) => {
    repo ??= repository(await git(['config', '--get', 'remote.origin.url']));
    const response = await fetch(`${base}/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${path} failed: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
}

async function publish(prefix, tipRef, exclude) {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('bot-git needs the App installation token in GH_TOKEN');
  const git = gitRunner(prefix);
  const tip = await git(['rev-parse', '--verify', `${tipRef}^{commit}`]);
  const result = await publishVerifiedCommits({
    git,
    api: apiFor(git, token),
    tip,
    exclude,
    coAuthor: parseCoAuthor(process.env.CAIRN_COAUTHOR),
    expectedAuthor: bot,
    stagingRef: `refs/cairn/publish/${randomBytes(8).toString('hex')}`,
  });
  if (result.tip !== tip) {
    const branch = spawnSync('git', [...prefix, 'symbolic-ref', '-q', 'HEAD'], {
      encoding: 'utf8',
    });
    const headRef = branch.status === 0 ? branch.stdout.trim() : 'HEAD';
    const target = tipRef === 'HEAD' ? headRef : `refs/heads/${tipRef}`;
    await git([
      'update-ref',
      ...(target === 'HEAD' ? ['--no-deref'] : []),
      target,
      result.tip,
      tip,
    ]);
  }
  return result;
}

async function push(prefix, pushArgs) {
  const { src } = pushTarget(pushArgs);
  const result = await publish(prefix, src, ['--remotes']);
  try {
    const pushed = spawnSync('git', [...prefix, 'push', ...pushArgs], { stdio: 'inherit' });
    return pushed.status ?? 1;
  } finally {
    await result.release();
  }
}

async function sign(prefix, base) {
  if (!base) throw new Error('bot-git sign needs the base commit');
  const result = await publish(prefix, 'HEAD', [base]);
  await result.release();
  return 0;
}

async function main(argv) {
  const { prefix, rest } = splitDirectory(argv);
  if (rest[0] === 'identity') {
    process.stdout.write(
      `${bot.name}\n${bot.email}\nCo-authored-by: ${owner.name} <${owner.email}>\n`,
    );
    return 0;
  }
  if (rest[0] === 'sign') return sign(prefix, rest[1]);
  if (rest[0] === 'push') return push(prefix, rest.slice(1));
  return spawnSync('git', argv, { stdio: 'inherit' }).status ?? 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
    const detail = cause ? ` (${cause.code ?? cause.name}: ${cause.message})` : '';
    console.error(`bot-git: ${error instanceof Error ? error.message : String(error)}${detail}`);
    process.exitCode = 1;
  }
}
