import { describe, expect, test, vi } from 'vitest';
import {
  type GhExecResult,
  GITHUB_PUSH_CACHE_TTL_MS,
  GITHUB_PUSH_UNKNOWN_TTL_MS,
  GithubPushProbe,
} from '../src/github-push-probe.js';

function okResult(stdout: string, stderr = ''): GhExecResult {
  return { ok: true, stdout, stderr, code: 0, killed: false, enoent: false };
}

function failResult(
  opts: {
    code?: number;
    stdout?: string;
    stderr?: string;
    killed?: boolean;
    enoent?: boolean;
  } = {},
): GhExecResult {
  return {
    ok: false,
    stdout: opts.stdout ?? '',
    stderr: opts.stderr ?? '',
    code: opts.code ?? 1,
    killed: opts.killed ?? false,
    enoent: opts.enoent ?? false,
  };
}

describe('GithubPushProbe', () => {
  test('unauthenticated or missing gh reports unauthenticated for all requested repos without calling graphql', async () => {
    const calls: string[][] = [];
    let now = 1_000_000;
    const probe = new GithubPushProbe({
      now: () => now,
      execGh: async (args) => {
        calls.push([...args]);
        return failResult({ code: 1, stderr: 'You are not logged into any GitHub hosts.' });
      },
    });
    probe.setRepos(['octo/app', 'octo/docs']);
    await probe.settled();

    expect(calls).toEqual([['auth', 'status', '--hostname', 'github.com']]);
    expect(probe.current()).toEqual({
      login: 'unauthenticated',
      checkedAt: now,
      repos: [
        { repo: 'octo/app', state: 'unauthenticated', checkedAt: now },
        { repo: 'octo/docs', state: 'unauthenticated', checkedAt: now },
      ],
    });

    now += 10_000;
    const enoentProbe = new GithubPushProbe({
      now: () => now,
      execGh: async (args) => {
        calls.push([...args]);
        return failResult({ enoent: true });
      },
    });
    enoentProbe.setRepos(['octo/app']);
    await enoentProbe.settled();
    expect(enoentProbe.current()).toEqual({
      login: 'unauthenticated',
      checkedAt: now,
      repos: [{ repo: 'octo/app', state: 'unauthenticated', checkedAt: now }],
    });
  });

  test('killed or timed-out auth check maps to unknown', async () => {
    const now = 2_000_000;
    const probe = new GithubPushProbe({
      now: () => now,
      execGh: async () => failResult({ killed: true }),
    });
    probe.setRepos(['octo/app']);
    await probe.settled();
    expect(probe.current()).toEqual({
      login: 'unknown',
      checkedAt: now,
      repos: [{ repo: 'octo/app', state: 'unknown', checkedAt: now }],
    });
  });

  test.each([
    ['ADMIN', 'write'],
    ['MAINTAIN', 'write'],
    ['WRITE', 'write'],
    ['READ', 'no-write'],
    ['TRIAGE', 'no-write'],
    ['MODERATE', 'no-write'],
    ['TRIAGE_PLUS', 'no-write'],
    [null, 'no-write'],
  ] as const)('maps viewerPermission=%s to %s', async (permission, expectedState) => {
    const now = 3_000_000;
    const probe = new GithubPushProbe({
      now: () => now,
      execGh: async (args) => {
        if (args[0] === 'auth') return okResult('Logged in to github.com account octo (keyring)');
        return okResult(
          JSON.stringify({
            data: { repository: permission === null ? null : { viewerPermission: permission } },
          }),
        );
      },
    });
    probe.setRepos(['octo/app']);
    await probe.settled();
    expect(probe.current()).toEqual({
      login: 'ok',
      checkedAt: now,
      repos: [{ repo: 'octo/app', state: expectedState, checkedAt: now }],
    });
  });

  test('maps GraphQL NOT_FOUND/FORBIDDEN to no-write, 401 to unauthenticated, and 5xx/invalid JSON to unknown', async () => {
    const now = 4_000_000;
    const probe = new GithubPushProbe({
      now: () => now,
      execGh: async (args) => {
        if (args[0] === 'auth') return okResult('Logged in to github.com account octo (keyring)');
        const ownerArg = args.find((a) => a.startsWith('owner='));
        if (ownerArg === 'owner=missing') {
          return failResult({
            code: 1,
            stdout: JSON.stringify({
              data: { repository: null },
              errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }],
            }),
          });
        }
        if (ownerArg === 'owner=badtoken') {
          return failResult({ code: 1, stderr: 'HTTP 401: Bad credentials' });
        }
        if (ownerArg === 'owner=badjson') {
          return okResult('not-json');
        }
        return failResult({ code: 1, stderr: 'HTTP 502: Bad Gateway' });
      },
    });
    probe.setRepos(['missing/repo', 'badtoken/repo', 'badjson/repo', 'upstream/repo']);
    await probe.settled();
    expect(probe.current()?.repos).toEqual([
      { repo: 'badjson/repo', state: 'unknown', checkedAt: now },
      { repo: 'badtoken/repo', state: 'unauthenticated', checkedAt: now },
      { repo: 'missing/repo', state: 'no-write', checkedAt: now },
      { repo: 'upstream/repo', state: 'unknown', checkedAt: now },
    ]);
  });

  test('caches fresh repo probes across TTL and retries unknown earlier than write', async () => {
    let now = 5_000_000;
    const graphqlCalls: string[] = [];
    let flaked = true;
    const probe = new GithubPushProbe({
      now: () => now,
      execGh: async (args) => {
        if (args[0] === 'auth') return okResult('Logged in to github.com account octo (keyring)');
        const owner = args.find((a) => a.startsWith('owner='))?.slice('owner='.length) ?? '';
        const name = args.find((a) => a.startsWith('name='))?.slice('name='.length) ?? '';
        graphqlCalls.push(`${owner}/${name}`);
        if (name === 'flaky' && flaked) return failResult({ code: 1, stderr: 'HTTP 503' });
        return okResult(JSON.stringify({ data: { repository: { viewerPermission: 'WRITE' } } }));
      },
    });
    probe.setRepos(['octo/stable', 'octo/flaky']);
    await probe.settled();
    expect(graphqlCalls).toEqual(['octo/flaky', 'octo/stable']);
    expect(probe.current()?.repos.find((r) => r.repo === 'octo/flaky')?.state).toBe('unknown');

    graphqlCalls.length = 0;
    now += 30_000;
    await probe.refresh();
    expect(graphqlCalls).toEqual([]);

    now += GITHUB_PUSH_UNKNOWN_TTL_MS;
    flaked = false;
    await probe.refresh();
    expect(graphqlCalls).toEqual(['octo/flaky']);
    expect(probe.current()?.repos.find((r) => r.repo === 'octo/flaky')?.state).toBe('write');

    graphqlCalls.length = 0;
    now += GITHUB_PUSH_CACHE_TTL_MS;
    await probe.refresh();
    expect(graphqlCalls).toEqual(['octo/flaky', 'octo/stable']);
  });

  test('invalidates repo cache immediately when auth fingerprint changes and emits onChange', async () => {
    let now = 6_000_000;
    let account = 'reader';
    const onChange = vi.fn();
    let graphqlCount = 0;
    const probe = new GithubPushProbe({
      now: () => now,
      onChange,
      execGh: async (args) => {
        if (args[0] === 'auth') {
          if (account === 'none') return failResult({ code: 1, stderr: 'not logged in' });
          return okResult(`Logged in to github.com account ${account} (keyring)`);
        }
        graphqlCount += 1;
        const perm = account === 'writer' ? 'WRITE' : 'READ';
        return okResult(JSON.stringify({ data: { repository: { viewerPermission: perm } } }));
      },
    });
    probe.setRepos(['octo/app']);
    await probe.settled();
    expect(probe.current()?.repos).toEqual([
      { repo: 'octo/app', state: 'no-write', checkedAt: now },
    ]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(graphqlCount).toBe(1);

    now += 5_000;
    account = 'writer';
    await probe.refresh();
    expect(graphqlCount).toBe(2);
    expect(probe.current()?.repos).toEqual([{ repo: 'octo/app', state: 'write', checkedAt: now }]);
    expect(onChange).toHaveBeenCalledTimes(2);

    now += 5_000;
    account = 'none';
    await probe.refresh();
    expect(probe.current()).toEqual({
      login: 'unauthenticated',
      checkedAt: now,
      repos: [{ repo: 'octo/app', state: 'unauthenticated', checkedAt: now }],
    });
    expect(onChange).toHaveBeenCalledTimes(3);

    now += 5_000;
    account = 'writer';
    await probe.refresh();
    expect(graphqlCount).toBe(3);
    expect(probe.current()?.repos).toEqual([{ repo: 'octo/app', state: 'write', checkedAt: now }]);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  test('deduplicates, caps at 200, prunes removed repos, and omits raw auth text', async () => {
    const now = 7_000_000;
    const rawSecretText = 'Logged in as super-secret-handle token=ghp_123456';
    const probe = new GithubPushProbe({
      now: () => now,
      execGh: async (args) => {
        if (args[0] === 'auth') return okResult(rawSecretText);
        return okResult(JSON.stringify({ data: { repository: { viewerPermission: 'WRITE' } } }));
      },
    });
    const many = Array.from({ length: 220 }, (_, i) => `octo/repo-${String(i).padStart(3, '0')}`);
    probe.setRepos(['Octo/Repo-000', ...many]);
    await probe.settled();

    const report = probe.current();
    expect(report?.repos).toHaveLength(200);
    expect(JSON.stringify(report)).not.toContain('super-secret-handle');
    expect(JSON.stringify(report)).not.toContain('ghp_123456');

    probe.setRepos(['Octo/Repo-000']);
    await probe.settled();
    expect(probe.current()?.repos.map((r) => r.repo)).toEqual(['Octo/Repo-000']);
  });

  test('passes owner and repo as raw -f string fields so numeric or boolean names are not coerced', async () => {
    const seenArgs: string[][] = [];
    const probe = new GithubPushProbe({
      execGh: async (args) => {
        if (args[0] === 'auth') return okResult('Logged in to github.com account octo (keyring)');
        seenArgs.push([...args]);
        return okResult(JSON.stringify({ data: { repository: { viewerPermission: 'WRITE' } } }));
      },
    });
    probe.setRepos(['123/true']);
    await probe.settled();
    expect(seenArgs).toHaveLength(1);
    expect(seenArgs[0]).not.toContain('-F');
    expect(seenArgs[0]).toContain('-f');
    expect(seenArgs[0]).toContain('owner=123');
    expect(seenArgs[0]).toContain('name=true');
    expect(probe.current()?.repos[0]?.state).toBe('write');
  });
});
