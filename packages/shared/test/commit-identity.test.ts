import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  appBotIdentity,
  type CommitFacts,
  type CommitIdentityPolicy,
  commitIdentityViolation,
  GITHUB_WEB_COMMITTER,
  type GitIdentity,
  isAgentEnvironment,
  localCommitViolation,
  type PublishApi,
  publishVerifiedCommits,
  pushViolation,
  withCoAuthor,
} from '../src/commit-identity.js';

const policy = JSON.parse(
  readFileSync(new URL('../commit-identity.json', import.meta.url), 'utf8'),
) as CommitIdentityPolicy;

const bot = appBotIdentity('cairnwright', 347615582);
const owner = { name: 'xiechimon', email: 'xiechimon@qq.com' };
const ownerNoreply = {
  name: 'xiechimon',
  email: '157263579+xiechimon@users.noreply.github.com',
};
const retiredUser = {
  name: 'Cairnwright',
  email: '348051526+cairnwright@users.noreply.github.com',
};
const synthetic = { name: 'Session', email: 'kigv1zSwiHPke_Cl5Ci6D@cairn.local' };
const mergify = { name: 'Mergify', email: '37929162+mergify[bot]@users.noreply.github.com' };
const mergifySigner = { name: 'Mergify', email: 'commit-signer@mergify.com' };

const facts = (
  author: GitIdentity,
  committer: GitIdentity,
  verified: boolean | null,
  parents = 1,
): CommitFacts => ({ sha: 'a'.repeat(40), author, committer, parents, verified });

describe('the App identity', () => {
  test('is the App bot user with its noreply email', () => {
    expect(bot).toEqual({
      name: 'cairnwright[bot]',
      email: '347615582+cairnwright[bot]@users.noreply.github.com',
    });
  });

  test('rejects a malformed slug or id', () => {
    expect(() => appBotIdentity('bad slug', 1)).toThrow();
    expect(() => appBotIdentity('cairnwright', 0)).toThrow();
  });
});

describe('the co-author trailer', () => {
  test('is appended once, case-insensitively', () => {
    const once = withCoAuthor('fix: x', ownerNoreply);
    expect(once).toBe(
      'fix: x\n\nCo-authored-by: xiechimon <157263579+xiechimon@users.noreply.github.com>',
    );
    expect(withCoAuthor(once.toUpperCase(), ownerNoreply)).toBe(once.toUpperCase());
  });

  test('joins an existing trailer block instead of starting a new paragraph', () => {
    expect(withCoAuthor('fix: x\n\ncloses #1\nCairn-Thread: t', ownerNoreply)).toBe(
      'fix: x\n\ncloses #1\nCairn-Thread: t\nCo-authored-by: xiechimon <157263579+xiechimon@users.noreply.github.com>',
    );
  });

  test('is absent when nobody instructed the work', () => {
    expect(withCoAuthor('fix: x', null)).toBe('fix: x');
  });

  test('refuses an identity that could inject a header', () => {
    expect(() => withCoAuthor('fix', { name: 'a\nb', email: 'x@y' })).toThrow();
  });
});

describe('the CI allowlist', () => {
  test.each([
    ['an API commit by the App', facts(bot, GITHUB_WEB_COMMITTER, true)],
    ['an update-branch merge by the App', facts(bot, GITHUB_WEB_COMMITTER, true, 2)],
    ['ian by hand', facts(owner, owner, null)],
    ['ian through his noreply email', facts(ownerNoreply, ownerNoreply, null)],
    [
      'a squash of an ian-opened PR',
      facts({ ...owner, name: 'Xmon Dai' }, GITHUB_WEB_COMMITTER, true),
    ],
    ['a Mergify queue merge', facts(mergify, mergifySigner, true, 2)],
  ])('accepts %s', (_name, commit) => {
    expect(commitIdentityViolation(policy, commit)).toBeNull();
  });

  test.each([
    ['source 2: the retired Cairnwright user', facts(retiredUser, retiredUser, null)],
    ['source 2 rebased by ian', facts(retiredUser, { ...owner, name: 'Xmon Dai' }, null)],
    ['source 4: the synthetic step identity', facts(synthetic, synthetic, null)],
    ['a bot commit pushed with git, not the API', facts(bot, bot, null)],
    ['a bot commit with a forged GitHub committer', facts(bot, GITHUB_WEB_COMMITTER, false)],
    ['the old split identity', facts(retiredUser, bot, null)],
    ['a Mergify non-merge commit', facts(mergify, mergifySigner, true, 1)],
    [
      'an unknown bot',
      facts(
        { name: 'x[bot]', email: '1+x[bot]@users.noreply.github.com' },
        GITHUB_WEB_COMMITTER,
        true,
      ),
    ],
    ['ian authored but committed by someone else', facts(owner, synthetic, null)],
  ])('rejects %s', (_name, commit) => {
    expect(commitIdentityViolation(policy, commit)).toMatch(/./);
  });
});

describe('the local hooks', () => {
  const agent = { AI_AGENT: 'claude-code_2_agent' };
  const human = { HOME: '/home/ian' };

  test('recognise each agent runtime and nothing else', () => {
    for (const name of policy.agentEnv)
      expect(isAgentEnvironment(policy, { [name]: '1' })).toBe(true);
    expect(isAgentEnvironment(policy, human)).toBe(false);
    expect(isAgentEnvironment(policy, { CLAUDECODE: '' })).toBe(false);
  });

  test('source 3: an agent committing with the global xiechimon config is rejected', () => {
    expect(localCommitViolation(policy, owner, owner, agent)).toMatch(/as-bot\.sh git commit/);
  });

  test('an agent committing as the App is accepted', () => {
    expect(localCommitViolation(policy, bot, bot, agent)).toBeNull();
  });

  test('ian committing by hand is accepted', () => {
    expect(localCommitViolation(policy, owner, owner, human)).toBeNull();
  });

  test.each([retiredUser, synthetic])('%o is rejected for everyone', (identity) => {
    expect(localCommitViolation(policy, identity, identity, human)).toMatch(/./);
    expect(localCommitViolation(policy, identity, identity, agent)).toMatch(/./);
  });

  test('an agent pushing a locally made bot commit is told to publish through the API', () => {
    expect(pushViolation(policy, [facts(bot, bot, null)], agent)).toMatch(/as-bot\.sh git push/);
    expect(pushViolation(policy, [facts(bot, GITHUB_WEB_COMMITTER, null)], agent)).toBeNull();
    expect(pushViolation(policy, [facts(owner, owner, null)], human)).toBeNull();
    expect(pushViolation(policy, [facts(owner, owner, null)], agent)).toMatch(/./);
  });
});

type Commit = {
  tree: string;
  parents: string[];
  author: GitIdentity;
  committer: GitIdentity;
  message: string;
};

function fakeRemote(options: { verified?: boolean; author?: GitIdentity } = {}) {
  const objects = new Map<string, Commit>();
  const remoteRefs = new Map<string, string>();
  const localRefs = new Map<string, string>();
  const calls: string[] = [];
  let next = 0;
  const add = (commit: Commit) => {
    const sha = (++next).toString(16).padStart(40, '0');
    objects.set(sha, commit);
    return sha;
  };
  const reachable = (from: string[]) => {
    const seen = new Set<string>();
    const stack = [...from];
    while (stack.length) {
      const sha = stack.pop() as string;
      if (seen.has(sha)) continue;
      seen.add(sha);
      stack.push(...(objects.get(sha)?.parents ?? []));
    }
    return seen;
  };
  const git = async (args: string[]) => {
    calls.push(`git ${args.join(' ')}`);
    if (args[0] === 'rev-list') {
      const tip = args[3] as string;
      const excluded = reachable(
        [...localRefs.entries()]
          .filter(([ref]) => ref.startsWith('refs/remotes/'))
          .map(([, sha]) => sha),
      );
      const order: string[] = [];
      const visit = (sha: string) => {
        if (excluded.has(sha) || order.includes(sha)) return;
        for (const parent of objects.get(sha)?.parents ?? []) visit(parent);
        order.push(sha);
      };
      visit(tip);
      return order.join('\n');
    }
    if (args[0] === 'show') {
      const commit = objects.get(args.at(-1) as string) as Commit;
      return [
        commit.tree,
        commit.parents.join(' '),
        commit.author.name,
        commit.author.email,
        commit.committer.name,
        commit.committer.email,
        commit.message,
      ].join('\0');
    }
    if (args[0] === 'push') {
      const [src, dst] = (args.at(-1) as string).split(':');
      remoteRefs.set(dst as string, src as string);
      return '';
    }
    if (args[0] === 'fetch') {
      const [src, dst] = (args.at(-1) as string).replace(/^\+/, '').split(':');
      localRefs.set(dst as string, remoteRefs.get(src as string) as string);
      return '';
    }
    if (args[0] === 'rev-parse') return localRefs.get(args[1] as string) ?? '';
    if (args[0] === 'update-ref') {
      localRefs.delete(args[2] as string);
      return '';
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  const api: PublishApi = async (method, path, body) => {
    calls.push(`${method} ${path}`);
    if (method === 'POST' && path === '/git/commits') {
      const input = body as { tree: string; parents: string[]; message: string };
      const author = options.author ?? bot;
      const sha = add({ ...input, author, committer: GITHUB_WEB_COMMITTER });
      return { sha, author, verification: { verified: options.verified ?? true } };
    }
    if (method === 'PATCH') {
      remoteRefs.set(`refs/${path.replace('/git/refs/', '')}`, (body as { sha: string }).sha);
      return {};
    }
    if (method === 'DELETE') {
      remoteRefs.delete(`refs/${path.replace('/git/refs/', '')}`);
      return null;
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { objects, remoteRefs, localRefs, calls, add, git, api };
}

describe('verified publish', () => {
  const stagingRef = 'refs/cairn/publish/n1';

  function lane(options?: Parameters<typeof fakeRemote>[0]) {
    const remote = fakeRemote(options);
    const main = remote.add({
      tree: 't0',
      parents: [],
      author: owner,
      committer: owner,
      message: 'base',
    });
    remote.localRefs.set('refs/remotes/origin/main', main);
    const first = remote.add({
      tree: 't1',
      parents: [main],
      author: synthetic,
      committer: synthetic,
      message: 'session: one',
    });
    const second = remote.add({
      tree: 't2',
      parents: [first],
      author: owner,
      committer: owner,
      message: 'fix: two\n\ncloses #9',
    });
    return { ...remote, main, first, second };
  }

  test('replays every unpublished commit through the API as the App with the co-author trailer', async () => {
    const r = lane();
    const result = await publishVerifiedCommits({
      git: r.git,
      api: r.api,
      tip: r.second,
      exclude: ['--remotes'],
      coAuthor: ownerNoreply,
      expectedAuthor: bot,
      stagingRef,
    });
    expect(result.tip).not.toBe(r.second);
    const tip = r.objects.get(result.tip) as Commit;
    const parent = r.objects.get(tip.parents[0] as string) as Commit;
    expect(tip.tree).toBe('t2');
    expect(parent.tree).toBe('t1');
    expect(parent.parents).toEqual([r.main]);
    expect([tip.author, parent.author]).toEqual([bot, bot]);
    expect(tip.message).toBe(
      'fix: two\n\ncloses #9\n\nCo-authored-by: xiechimon <157263579+xiechimon@users.noreply.github.com>',
    );
    expect(r.localRefs.get(stagingRef)).toBe(result.tip);
    await result.release();
    expect(r.remoteRefs.has(stagingRef)).toBe(false);
    expect(r.localRefs.has(stagingRef)).toBe(false);
  });

  test('stages the original objects before asking the API for commits', async () => {
    const r = lane();
    await (
      await publishVerifiedCommits({
        git: r.git,
        api: r.api,
        tip: r.second,
        exclude: ['--remotes'],
        coAuthor: null,
        expectedAuthor: bot,
        stagingRef,
      })
    ).release();
    const push = r.calls.findIndex((c) => c.startsWith('git push'));
    const create = r.calls.indexOf('POST /git/commits');
    expect(push).toBeGreaterThanOrEqual(0);
    expect(push).toBeLessThan(create);
    expect(r.calls[push]).not.toContain('--no-verify');
  });

  test('keeps commits the API already made and touches nothing when there is nothing to replay', async () => {
    const r = lane();
    const made = r.add({
      tree: 't3',
      parents: [r.main],
      author: bot,
      committer: GITHUB_WEB_COMMITTER,
      message: 'already',
    });
    const result = await publishVerifiedCommits({
      git: r.git,
      api: r.api,
      tip: made,
      exclude: ['--remotes'],
      coAuthor: null,
      expectedAuthor: bot,
      stagingRef,
    });
    expect(result.tip).toBe(made);
    expect(
      r.calls.filter((c) => !c.startsWith('git rev-list') && !c.startsWith('git show')),
    ).toEqual([]);
  });

  test('fails instead of accepting an unverified API commit, and removes the staging ref', async () => {
    const r = lane({ verified: false });
    await expect(
      publishVerifiedCommits({
        git: r.git,
        api: r.api,
        tip: r.second,
        exclude: ['--remotes'],
        coAuthor: null,
        expectedAuthor: bot,
        stagingRef,
      }),
    ).rejects.toThrow(/not verified/);
    expect(r.remoteRefs.has(stagingRef)).toBe(false);
  });

  test('fails when the token commits as someone other than the expected App', async () => {
    const r = lane({ author: ownerNoreply });
    await expect(
      publishVerifiedCommits({
        git: r.git,
        api: r.api,
        tip: r.second,
        exclude: ['--remotes'],
        coAuthor: null,
        expectedAuthor: bot,
        stagingRef,
      }),
    ).rejects.toThrow(/authored as xiechimon/);
    expect(r.remoteRefs.has(stagingRef)).toBe(false);
  });

  test('a dropped connection on the first staging-ref delete still removes the ref', async () => {
    const r = lane();
    let drops = 1;
    const api: PublishApi = async (method, path, body) => {
      if (method === 'DELETE' && drops-- > 0) throw new TypeError('fetch failed');
      return r.api(method, path, body);
    };
    const result = await publishVerifiedCommits({
      git: r.git,
      api,
      tip: r.second,
      exclude: ['--remotes'],
      coAuthor: null,
      expectedAuthor: bot,
      stagingRef,
    });
    await result.release();
    expect(r.remoteRefs.has(stagingRef)).toBe(false);
  });
});
