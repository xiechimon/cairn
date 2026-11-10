import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  appBotIdentity,
  type CommitFacts,
  type CommitIdentityPolicy,
  commitIdentityViolation,
  type GitIdentity,
  isAgentEnvironment,
  localCommitIdentity,
  localCommitViolation,
  pushViolation,
  withCoAuthor,
} from '../src/commit-identity.js';

const policy = JSON.parse(
  readFileSync(new URL('../commit-identity.json', import.meta.url), 'utf8'),
) as CommitIdentityPolicy;

const bot = appBotIdentity('cairnwright', 347615582);
const web = { name: 'GitHub', email: 'noreply@github.com' };
const owner = { name: 'xiechimon', email: 'xiechimon@qq.com' };
const ownerNoreply = {
  name: 'xiechimon',
  email: '157263579+xiechimon@users.noreply.github.com',
};
const retiredUser = {
  name: 'Cairnwright',
  email: '348051526+cairnwright@users.noreply.github.com',
};
const cloud = { name: 'Claude', email: 'noreply@anthropic.com' };
const synthetic = { name: 'Session', email: 'kigv1zSwiHPke_Cl5Ci6D@cairn.local' };
const mergify = { name: 'Mergify', email: '37929162+mergify[bot]@users.noreply.github.com' };
const mergifySigner = { name: 'Mergify', email: 'commit-signer@mergify.com' };

const facts = (author: GitIdentity, committer: GitIdentity, parents = 1): CommitFacts => ({
  sha: 'a'.repeat(40),
  author,
  committer,
  parents,
});

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

  test('without an App, cairn commits as a local identity', () => {
    expect(localCommitIdentity('Cairn')).toEqual({ name: 'Cairn', email: 'cairn@localhost' });
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
    ['baeb30d98 (#3486): an App commit made through the GitHub API', facts(bot, web)],
    ['an App commit made with git', facts(bot, bot)],
    ['an update-branch merge by the App', facts(bot, web, 2)],
    ['an App commit ian rebased', facts(bot, owner)],
    ['ian by hand', facts(owner, owner)],
    ['ian through his noreply email', facts(ownerNoreply, ownerNoreply)],
    ['a squash of an ian-opened PR', facts({ ...owner, name: 'Xmon Dai' }, web)],
    ['a Mergify queue merge', facts(mergify, mergifySigner, 2)],
    ['a cloud session commit made with git', facts(cloud, cloud)],
    ['a cloud session merging main into its branch', facts(cloud, cloud, 2)],
    ['a cloud session commit GitHub rewrote', facts(cloud, web)],
    ['an App commit a cloud session rebased', facts(bot, cloud)],
  ])('accepts %s on a branch of this repository', (_name, commit) => {
    expect(commitIdentityViolation(policy, commit, false)).toBeNull();
  });

  test.each([
    ['the App', facts(bot, bot)],
    ['ian', facts(owner, owner)],
    ['a cloud session', facts(cloud, cloud)],
  ])('rejects %s claimed from a fork', (_name, commit) => {
    expect(commitIdentityViolation(policy, commit, true)).toMatch(/fork/);
  });

  test.each([
    ['source 2: the retired Cairnwright user', facts(retiredUser, retiredUser)],
    ['source 2 rebased by ian', facts(retiredUser, { ...owner, name: 'Xmon Dai' })],
    ['source 4: the synthetic step identity', facts(synthetic, synthetic)],
    ['the old split identity', facts(retiredUser, bot)],
    ['the bot name on a forged email', facts({ ...bot, email: 'bot@evil.test' }, web)],
    ['the bot email under a human name', facts({ ...bot, name: 'xiechimon' }, web)],
    ['the owner name on a stranger email', facts({ ...owner, email: 'x@evil.test' }, web)],
    ['a Mergify non-merge commit', facts(mergify, mergifySigner, 1)],
    ['an unknown bot', facts({ name: 'x[bot]', email: '1+x[bot]@users.noreply.github.com' }, web)],
    ['ian authored but committed by someone else', facts(owner, synthetic)],
    ['the cloud name on a forged email', facts({ ...cloud, email: 'noreply@evil.test' }, web)],
    ['the cloud email under another name', facts({ ...cloud, name: 'xiechimon' }, web)],
    ['a cloud session authored but committed by someone else', facts(cloud, synthetic)],
    ['the App authored but committed by someone else', facts(bot, synthetic)],
  ])('rejects %s', (_name, commit) => {
    expect(commitIdentityViolation(policy, commit, false)).toMatch(/./);
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

  test('a cloud session committing as itself is accepted, in an agent runtime and outside one', () => {
    expect(localCommitViolation(policy, cloud, cloud, agent)).toBeNull();
    expect(localCommitViolation(policy, cloud, cloud, human)).toBeNull();
  });

  test('an agent mixing the cloud identity with another one is rejected', () => {
    expect(localCommitViolation(policy, cloud, owner, agent)).toMatch(/as-bot\.sh git commit/);
    expect(localCommitViolation(policy, owner, cloud, agent)).toMatch(/as-bot\.sh git commit/);
    expect(localCommitViolation(policy, cloud, bot, agent)).toMatch(/as-bot\.sh git commit/);
  });

  test('ian committing by hand is accepted', () => {
    expect(localCommitViolation(policy, owner, owner, human)).toBeNull();
  });

  test('the identity of a cairn server without an App is rejected with the server setting that fixes it', () => {
    const local = localCommitIdentity('Session');
    for (const env of [human, agent])
      expect(localCommitViolation(policy, local, local, env)).toMatch(
        /cairn server without a GitHub App identity: set CAIRN_GITHUB_APP_SLUG and CAIRN_GITHUB_APP_BOT_ID/,
      );
  });

  test.each([retiredUser, synthetic])('%o is rejected for everyone', (identity) => {
    expect(localCommitViolation(policy, identity, identity, human)).toMatch(/./);
    expect(localCommitViolation(policy, identity, identity, agent)).toMatch(/./);
  });

  test('an agent pushes only App-authored commits; ian pushes his own too', () => {
    expect(pushViolation(policy, [facts(bot, bot)], agent)).toBeNull();
    expect(pushViolation(policy, [facts(bot, web)], agent)).toBeNull();
    expect(pushViolation(policy, [facts(cloud, cloud)], agent)).toBeNull();
    expect(pushViolation(policy, [facts(cloud, cloud)], human)).toBeNull();
    expect(pushViolation(policy, [facts(owner, owner)], agent)).toMatch(/as-bot\.sh git commit/);
    expect(pushViolation(policy, [facts(owner, owner)], human)).toBeNull();
    expect(pushViolation(policy, [facts(synthetic, synthetic)], human)).toMatch(/./);
  });
});
