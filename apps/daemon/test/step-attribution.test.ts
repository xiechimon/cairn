import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { runGitOk, withGitCredentialFallback } from '../src/git.js';
import { ensureStepCoauthor } from '../src/step-attribution.js';
import { testTempDir } from './test-temp-dir.js';

test.each([null, { name: 'Human', email: '12+human@users.noreply.github.com' }])(
  'attributes only unpublished step commits: %j',
  async (identity) => {
    const root = testTempDir('coauthor-');
    const remote = join(root, 'remote');
    const dir = join(root, 'work');
    await runGitOk(['init', '--bare', remote]);
    await runGitOk(['clone', remote, dir]);
    const git = (args: string[]) =>
      runGitOk(args, {
        cwd: dir,
        env: {
          GIT_AUTHOR_NAME: 'Agent',
          GIT_AUTHOR_EMAIL: 'agent@example.com',
          GIT_COMMITTER_NAME: 'Agent',
          GIT_COMMITTER_EMAIL: 'agent@example.com',
        },
      });
    writeFileSync(join(dir, 'a'), 'base');
    await git(['add', 'a']);
    await git(['commit', '-m', 'published']);
    await git(['push', 'origin', 'HEAD:work']);
    const base = await git(['rev-parse', 'HEAD']);
    writeFileSync(join(dir, 'a'), 'published during step');
    await git(['add', 'a']);
    await git(['commit', '-m', 'published during step']);
    await git(['push', 'origin', 'HEAD:refs/tags/published-step']);
    const published = await git(['rev-parse', 'HEAD']);
    for (const name of ['one', 'two']) {
      writeFileSync(join(dir, 'a'), name);
      await git(['add', 'a']);
      await git([
        'commit',
        '-m',
        name === 'two' && identity
          ? `two\n\nCo-authored-by: ${identity.name} <${identity.email}>`
          : name,
      ]);
    }
    await ensureStepCoauthor(dir, await git(['branch', '--show-current']), base, identity, null);
    await ensureStepCoauthor(dir, await git(['branch', '--show-current']), base, identity, null);
    const messages = (await git(['log', '--format=%B%x00', `${published}..HEAD`]))
      .split('\0')
      .filter((s) => s.trim());
    expect(messages).toHaveLength(2);
    for (const message of messages)
      expect(message.match(/Co-authored-by:/g)?.length ?? 0).toBe(identity ? 1 : 0);
    expect(await git(['rev-parse', 'HEAD~2'])).toBe(published);
    expect(await git(['log', '-1', '--format=%B', published])).toBe('published during step');
    expect(await git(['ls-remote', 'origin', 'refs/tags/published-step'])).toContain(published);
  },
);

test.each([false, true])(
  'App authentication refreshes once without machine fallback: %s',
  async (twice) => {
    let calls = 0;
    const op = vi.fn(async (cred) => {
      expect(cred?.kind).toBe('app');
      calls++;
      if (calls === 1 || twice) throw new Error('Authentication failed');
    });
    const refresh = vi.fn(async () => ({
      username: 'git',
      password: 'replacement',
      url: 'https://github.com/o/r',
      kind: 'app' as const,
    }));
    const result = withGitCredentialFallback(
      op,
      { username: 'git', password: 'expired', url: 'https://github.com/o/r', kind: 'app' },
      { what: 'push', allowMachineFallback: true, refresh },
    );
    if (twice) await expect(result).rejects.toThrow('Authentication failed');
    else await expect(result).resolves.toBe('integration');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenCalledTimes(2);
  },
);
