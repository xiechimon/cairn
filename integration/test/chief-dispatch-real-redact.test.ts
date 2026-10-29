import { describe, expect, test } from 'vitest';
import {
  HIGH_RISK_AFTER_REDACTION,
  redactDispatchCase,
  redactDispatchCases,
} from '../eval/chief-dispatch-real/redact.mts';
import type { ExportedDispatchCase } from '../eval/chief-dispatch-real/types.mts';

const SENSITIVE = {
  name: 'Alice Chen',
  email: 'alice.chen@example.com',
  usersPath: '/Users/alice/Code/private-app/src/main.ts',
  homePath: '/home/alice/.cairn/server.db',
  hostname: 'omarchy-box.local',
  otherRepo: 'acme-corp/secret-radar',
  token: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345',
  githubPat: 'github_pat_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
};

function fixture(overrides: Partial<ExportedDispatchCase> = {}): ExportedDispatchCase {
  return {
    caseId: 'syn-1',
    prompt: `Please ask ${SENSITIVE.name} (${SENSITIVE.email}) to fix ${SENSITIVE.usersPath} on ${SENSITIVE.hostname}. Also check ${SENSITIVE.homePath} and open a PR in ${SENSITIVE.otherRepo}. Auth=${SENSITIVE.token}`,
    projectsSnapshot: [
      {
        id: 'proj-1',
        name: 'secret-radar',
        description: `Repo at ${SENSITIVE.usersPath}; contact ${SENSITIVE.email}`,
        agents: [
          {
            id: 'ag-1',
            key: 'code',
            displayName: SENSITIVE.name,
            description: `Works on ${SENSITIVE.hostname}`,
          },
        ],
      },
    ],
    dispatchedTo: {
      agentId: 'ag-1',
      displayName: SENSITIVE.name,
      key: 'code',
    },
    outcome: 'failed',
    ...overrides,
  };
}

describe('chief-dispatch-real redact', () => {
  test('names, emails, /Users and /home paths, hostnames and tokens are replaced', () => {
    const result = redactDispatchCase(fixture());
    expect(result.kept).toBe(true);
    if (!result.kept) throw new Error('expected kept');
    const text = JSON.stringify(result.case);
    expect(text).not.toContain(SENSITIVE.name);
    expect(text).not.toContain(SENSITIVE.email);
    expect(text).not.toContain(SENSITIVE.usersPath);
    expect(text).not.toContain(SENSITIVE.homePath);
    expect(text).not.toContain(SENSITIVE.hostname);
    expect(text).not.toContain(SENSITIVE.otherRepo);
    expect(text).not.toContain(SENSITIVE.token);
    expect(text).toMatch(/<PERSON_\d+>/);
    expect(text).toMatch(/<EMAIL_\d+>/);
    expect(text).toMatch(/<PATH_\d+>/);
    expect(text).toMatch(/<HOST_\d+>/);
    expect(text).toMatch(/\[REDACTED\]/);
  });

  test('placeholders are stable across cases for the same input', () => {
    const a = redactDispatchCase(fixture({ caseId: 'syn-a' }));
    const b = redactDispatchCase(fixture({ caseId: 'syn-b' }));
    expect(a.kept && b.kept).toBe(true);
    if (!(a.kept && b.kept)) throw new Error('expected kept');
    const personA = a.case.prompt.match(/<PERSON_\d+>/)?.[0];
    const personB = b.case.prompt.match(/<PERSON_\d+>/)?.[0];
    const emailA = a.case.prompt.match(/<EMAIL_\d+>/)?.[0];
    const emailB = b.case.prompt.match(/<EMAIL_\d+>/)?.[0];
    expect(personA).toBeDefined();
    expect(personA).toBe(personB);
    expect(emailA).toBeDefined();
    expect(emailA).toBe(emailB);
  });

  test('a case still matching a high-risk pattern after redaction is dropped', () => {
    const leak = fixture({
      prompt: `fix the service; leftover ip 203.0.113.44 and phone +1-415-555-0199 remain`,
      projectsSnapshot: [
        {
          id: 'proj-1',
          name: 'cairn',
          description: 'xiechimon/cairn',
          agents: [{ id: 'ag-1', key: 'ops', displayName: 'Ops', description: 'ops' }],
        },
      ],
      dispatchedTo: { agentId: 'ag-1', displayName: 'Ops', key: 'ops' },
    });
    const result = redactDispatchCase(leak);
    expect(result.kept).toBe(false);
    if (result.kept) throw new Error('expected dropped');
    expect(HIGH_RISK_AFTER_REDACTION.some((p) => p.test(leak.prompt))).toBe(true);
  });

  test('the redacted output of every fixture contains none of the fixture sensitive strings', () => {
    const fixtures = [
      fixture({ caseId: 'syn-1' }),
      fixture({
        caseId: 'syn-2',
        prompt: `Deploy using ${SENSITIVE.githubPat} from ${SENSITIVE.homePath}`,
      }),
      fixture({
        caseId: 'syn-3',
        prompt: `Ping ${SENSITIVE.hostname} and mail ${SENSITIVE.email}`,
      }),
    ];
    const sensitive = Object.values(SENSITIVE);
    const results = redactDispatchCases(fixtures);
    for (const item of results) {
      if (!item.kept) continue;
      const blob = JSON.stringify(item.case);
      for (const s of sensitive) {
        expect(blob.includes(s), `leaked ${s} in ${item.case.caseId}`).toBe(false);
      }
    }
  });

  test('private paths, single-label hostnames, standalone private repos and Chinese names are replaced', () => {
    const expanded = {
      srvPath: '/srv/private/service/config.yaml',
      singleHost: 'omarchy',
      bareRepo: 'secret-radar',
      chineseName: '张伟',
    };
    const result = redactDispatchCase(
      fixture({
        caseId: 'syn-expand',
        prompt: `Ask ${expanded.chineseName} to restart ${expanded.singleHost} using ${expanded.srvPath} in repo ${expanded.bareRepo}`,
        projectsSnapshot: [
          {
            id: 'proj-x',
            name: expanded.bareRepo,
            description: `hosted on ${expanded.singleHost}`,
            agents: [
              {
                id: 'ag-x',
                key: 'ops',
                displayName: expanded.chineseName,
                description: `path ${expanded.srvPath}`,
              },
            ],
          },
        ],
        dispatchedTo: {
          agentId: 'ag-x',
          displayName: expanded.chineseName,
          key: 'ops',
        },
      }),
    );
    expect(result.kept).toBe(true);
    if (!result.kept) throw new Error('expected kept');
    const text = JSON.stringify(result.case);
    expect(text).not.toContain(expanded.srvPath);
    expect(text).not.toContain(expanded.singleHost);
    expect(text).not.toContain(expanded.bareRepo);
    expect(text).not.toContain(expanded.chineseName);
    expect(text).toMatch(/<PATH_\d+>/);
    expect(text).toMatch(/<HOST_\d+>/);
    expect(text).toMatch(/<REPO_\d+>/);
    expect(text).toMatch(/<PERSON_\d+>/);
  });
});
