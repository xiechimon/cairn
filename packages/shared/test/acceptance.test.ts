import { describe, expect, test } from 'vitest';
import {
  type AcceptanceAttachment,
  type AcceptanceMessage,
  buildAcceptanceNudgePrompt,
  evaluateStepAcceptance,
  extractEditedPathsFromMessages,
  isAcceptanceNudgePrompt,
} from '../src/index.js';

function toolMsg(
  name: string,
  args: Record<string, unknown>,
  opts: { result?: unknown; isError?: boolean; createdAt: number },
): AcceptanceMessage {
  return {
    role: 'assistant',
    createdAt: opts.createdAt,
    content: {
      kind: 'toolcall',
      call: {
        id: `call-${opts.createdAt}`,
        name,
        arguments: args,
        result: opts.result ?? 'ok',
        isError: opts.isError ?? false,
        startedAt: opts.createdAt,
        endedAt: opts.createdAt,
      },
    },
  };
}

function textMsg(text: string, createdAt: number): AcceptanceMessage {
  return {
    role: 'assistant',
    createdAt,
    content: [{ type: 'text', text }],
  };
}

function shot(overrides: Partial<AcceptanceAttachment> = {}): AcceptanceAttachment {
  return {
    id: 'att-1',
    createdBy: 'step:step-1',
    fileName: 'live-app.png',
    mimeType: 'image/png',
    status: 'ready',
    grantId: 'grant-1',
    createdAt: 300,
    ...overrides,
  };
}

describe('evaluateStepAcceptance (Slice 2)', () => {
  test('normal deliveries pass with 0 retries across UI, API, CLI, doc, info, and read-only tasks', () => {
    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['apps/web/src/components/Board.tsx'],
        messages: [
          toolMsg('edit', { path: 'apps/web/src/components/Board.tsx' }, { createdAt: 100 }),
          toolMsg(
            'bash',
            { command: 'pnpm exec playwright test' },
            { result: 'passed', createdAt: 200 },
          ),
          toolMsg(
            'attach_file',
            { path: 'live-app.png', caption: 'Live running app after fix' },
            { result: 'attached', createdAt: 300 },
          ),
        ],
        attachments: [shot({ createdAt: 300 })],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: true });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['apps/server/src/routes.ts'],
        messages: [
          toolMsg('edit', { path: 'apps/server/src/routes.ts' }, { createdAt: 100 }),
          toolMsg(
            'bash',
            { command: 'curl -fsS http://127.0.0.1:8787/api/health' },
            { result: '{"ok":true}', createdAt: 200 },
          ),
        ],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: true });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['scripts/check.mjs'],
        messages: [
          toolMsg('edit', { path: 'scripts/check.mjs' }, { createdAt: 100 }),
          toolMsg(
            'bash',
            { command: 'node scripts/check.mjs' },
            { result: 'PASS', createdAt: 200 },
          ),
        ],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: true });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['docs/guide.md'],
        messages: [
          toolMsg('edit', { path: 'docs/guide.md' }, { createdAt: 100 }),
          toolMsg('read_file', { path: 'docs/guide.md' }, { result: '# Guide', createdAt: 200 }),
        ],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: true });

    expect(
      evaluateStepAcceptance({
        output: 'info',
        repoKind: 'hosted',
        hasChanges: false,
        editedPaths: [],
        messages: [
          toolMsg(
            'write_file',
            { path: '/home/agent/tasks/1/report.md' },
            { result: 'no machine offers computer', isError: true, createdAt: 100 },
          ),
          toolMsg('submit_report', { content: '# Direct Host Report' }, { createdAt: 200 }),
        ],
        attachments: [],
        stepIds: ['step-1'],
        report: '# Direct Host Report',
      }),
    ).toMatchObject({ ok: true });

    expect(
      evaluateStepAcceptance({
        output: 'info',
        repoKind: 'hosted',
        hasChanges: false,
        editedPaths: [],
        messages: [
          toolMsg('write_file', { path: '/home/agent/tasks/1/report.md' }, { createdAt: 100 }),
          toolMsg(
            'read_file',
            { path: '/home/agent/tasks/1/report.md' },
            { result: '# Findings\nGap: paywalled source unavailable', createdAt: 200 },
          ),
          toolMsg('submit_report', { path: '/home/agent/tasks/1/report.md' }, { createdAt: 300 }),
        ],
        attachments: [],
        stepIds: ['step-1'],
        report: '# Findings\nGap: paywalled source unavailable',
      }),
    ).toMatchObject({ ok: true });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: false,
        editedPaths: [],
        messages: [
          toolMsg(
            'read_file',
            { path: 'package.json' },
            { result: '{"name":"cairn"}', createdAt: 100 },
          ),
          textMsg('Verified version from package.json.', 150),
        ],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: true });

    expect(
      evaluateStepAcceptance({
        output: 'report',
        repoKind: 'github',
        hasChanges: false,
        editedPaths: [],
        messages: [
          toolMsg(
            'run_command',
            { CommandLine: 'git fetch origin main' },
            { result: 'Operation not permitted', isError: true, createdAt: 100 },
          ),
          toolMsg(
            'write_file',
            { Path: '/home/agent/.gemini/scratch/ci_runs_14d.json' },
            { createdAt: 150 },
          ),
          textMsg(
            '## 0. Sandbox Blocker\nCommand failed with Operation not permitted and spawn EPERM.',
            200,
          ),
        ],
        attachments: [],
        stepIds: ['step-1'],
        unpushedCommits: null,
      }),
    ).toMatchObject({ ok: true });

    expect(
      evaluateStepAcceptance({
        output: 'report',
        repoKind: 'hosted',
        hasChanges: false,
        editedPaths: [],
        messages: [
          toolMsg('write_file', { Path: '/ws/q3-review.html' }, { createdAt: 100 }),
          toolMsg(
            'read_file',
            { Path: '/ws/q3-review.html' },
            { result: '<html>...</html>', createdAt: 150 },
          ),
          toolMsg(
            'run_command',
            { CommandLine: 'python3 check.py' },
            {
              result:
                "Command exited with code 0.\npython3: error: couldn't create cache file (Operation not permitted)",
              isError: false,
              createdAt: 200,
            },
          ),
          toolMsg('mcp_cairn_attach_file', { path: 'q3-review.html' }, { createdAt: 250 }),
        ],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: true });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['packages/shared/src/records/acceptance.ts'],
        messages: [
          toolMsg(
            'edit',
            { path: 'packages/shared/src/records/acceptance.ts' },
            { createdAt: 100 },
          ),
          toolMsg(
            'read_file',
            { Path: 'packages/shared/src/records/acceptance.ts' },
            {
              result: 'const BLOCKER_RE = /spawn EPERM|operation not permitted/i;',
              createdAt: 150,
            },
          ),
          toolMsg(
            'bash',
            { command: 'pnpm exec vitest run test/acceptance.test.ts' },
            { result: '1 passed', createdAt: 200 },
          ),
        ],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: true });
  });

  test('rejects missing, fixture-only, pending/failed, and stale UI screenshots (#18)', () => {
    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['apps/web/src/App.tsx'],
        messages: [
          toolMsg('edit', { path: 'apps/web/src/App.tsx' }, { createdAt: 100 }),
          toolMsg(
            'bash',
            { command: 'pnpm exec playwright test' },
            { result: 'passed', createdAt: 200 },
          ),
        ],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'missing-ui-screenshot' });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['apps/web/src/App.tsx'],
        messages: [
          toolMsg('edit', { path: 'apps/web/src/App.tsx' }, { createdAt: 100 }),
          toolMsg(
            'attach_file',
            { path: 'fixture-shot.png', caption: 'Storybook fixture only' },
            { createdAt: 200 },
          ),
        ],
        attachments: [shot({ fileName: 'fixture-shot.png', createdAt: 200 })],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'fixture-only-screenshot' });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['apps/web/src/App.tsx'],
        messages: [
          toolMsg('edit', { path: 'apps/web/src/App.tsx' }, { createdAt: 100 }),
          toolMsg('attach_file', { path: 'live.png', caption: 'live app' }, { createdAt: 200 }),
        ],
        attachments: [shot({ status: 'pending', createdAt: 200 })],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'missing-ui-screenshot' });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['apps/web/src/App.tsx'],
        messages: [
          toolMsg('edit', { path: 'apps/web/src/App.tsx' }, { createdAt: 100 }),
          toolMsg('attach_file', { path: 'live.png', caption: 'live app' }, { createdAt: 200 }),
          toolMsg('edit', { path: 'apps/web/src/App.tsx' }, { createdAt: 400 }),
        ],
        attachments: [shot({ createdAt: 200 })],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'stale-ui-screenshot' });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['apps/web/src/App.tsx'],
        messages: [
          toolMsg('edit', { path: 'apps/web/src/App.tsx' }, { createdAt: 100 }),
          toolMsg('attach_file', { path: 'live.png', caption: 'live app' }, { createdAt: 150 }),
          toolMsg('edit', { path: 'apps/web/src/App.tsx' }, { createdAt: 200 }),
          toolMsg(
            'attach_file',
            { path: 'fixture-shot.png', caption: 'Storybook fixture' },
            { createdAt: 300 },
          ),
        ],
        attachments: [
          shot({ id: 'att-old', fileName: 'live.png', createdAt: 150 }),
          shot({ id: 'att-new', fileName: 'fixture-shot.png', createdAt: 300 }),
        ],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'fixture-only-screenshot' });
  });

  test('rejects failing post-edit checks, lint-only API checks, hollow claims, and unchecked deliverables (#45)', () => {
    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['scripts/build.mjs'],
        messages: [
          toolMsg('edit', { path: 'scripts/build.mjs' }, { createdAt: 100 }),
          toolMsg(
            'bash',
            { command: 'node scripts/build.mjs' },
            { result: 'Error', isError: true, createdAt: 200 },
          ),
        ],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'failing-check' });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['scripts/build.mjs'],
        messages: [
          toolMsg('edit', { path: 'scripts/build.mjs' }, { createdAt: 100 }),
          toolMsg(
            'bash',
            { command: 'node scripts/build.mjs' },
            { result: 'Error', isError: true, createdAt: 200 },
          ),
          toolMsg('bash', { command: 'git status' }, { result: 'clean', createdAt: 300 }),
        ],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'failing-check' });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['apps/server/src/routes.ts'],
        messages: [
          toolMsg('edit', { path: 'apps/server/src/routes.ts' }, { createdAt: 100 }),
          toolMsg('bash', { command: 'pnpm lint' }, { result: 'Checked 1 file', createdAt: 200 }),
        ],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'unverified-api' });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['apps/server/src/routes.ts'],
        messages: [
          toolMsg('edit', { path: 'apps/server/src/routes.ts' }, { createdAt: 100 }),
          toolMsg(
            'bash',
            { command: 'vitest run unit.test.ts' },
            { result: '1 passed', createdAt: 200 },
          ),
        ],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'unverified-api' });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: true,
        editedPaths: ['apps/server/src/routes.ts'],
        messages: [
          toolMsg('edit', { path: 'apps/server/src/routes.ts' }, { createdAt: 100 }),
          toolMsg(
            'bash',
            { command: 'curl -fsS http://127.0.0.1:8000/health 2>&1' },
            { result: 'ok', createdAt: 200 },
          ),
        ],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: true });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'hosted',
        hasChanges: false,
        editedPaths: [],
        messages: [textMsg('Ran all checks and verified working cleanly.', 100)],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'hollow-claim' });

    expect(
      evaluateStepAcceptance({
        output: 'info',
        repoKind: 'hosted',
        hasChanges: false,
        editedPaths: [],
        messages: [
          toolMsg('write_file', { path: '/home/agent/tasks/1/report.md' }, { createdAt: 100 }),
          toolMsg('submit_report', { path: '/home/agent/tasks/1/report.md' }, { createdAt: 200 }),
        ],
        attachments: [],
        stepIds: ['step-1'],
        report: '# Report without reading generated file back',
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'unverified-deliverable' });

    expect(
      evaluateStepAcceptance({
        output: 'info',
        repoKind: 'hosted',
        hasChanges: false,
        editedPaths: [],
        messages: [
          toolMsg(
            'bash',
            { command: 'python generate.py' },
            { result: 'wrote report.pdf', createdAt: 100 },
          ),
          toolMsg('submit_report', { content: '# Generated' }, { createdAt: 200 }),
        ],
        attachments: [],
        stepIds: ['step-1'],
        report: '# Generated',
        deliverables: { files: [{ name: 'report.pdf' }] },
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'unverified-deliverable' });

    expect(
      evaluateStepAcceptance({
        output: 'info',
        repoKind: 'hosted',
        hasChanges: false,
        editedPaths: [],
        messages: [
          toolMsg('write_file', { path: '/home/agent/tasks/1/report.md' }, { createdAt: 100 }),
          toolMsg(
            'write_file',
            { path: '/home/agent/tasks/1/deliverables/slides/deck.pdf' },
            { createdAt: 120 },
          ),
          toolMsg(
            'read_file',
            { path: '/home/agent/tasks/1/report.md' },
            { result: '# Report read, pdf skipped', createdAt: 150 },
          ),
          toolMsg('submit_report', { path: '/home/agent/tasks/1/report.md' }, { createdAt: 200 }),
        ],
        attachments: [],
        stepIds: ['step-1'],
        report: '# Report',
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'unverified-deliverable' });
  });

  test('detects explicit blockers and GitHub unpushed or unknown states (#38, #53, #54)', () => {
    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'github',
        hasChanges: false,
        editedPaths: ['apps/server/src/app.ts'],
        messages: [
          toolMsg('edit', { path: 'apps/server/src/app.ts' }, { createdAt: 100 }),
          toolMsg(
            'bash',
            { command: 'vitest run' },
            { result: 'Error: spawn EPERM', isError: true, createdAt: 200 },
          ),
          textMsg('Blocked by sandbox spawn EPERM, waiting for CI.', 250),
        ],
        attachments: [],
        stepIds: ['step-1'],
      }),
    ).toMatchObject({ ok: false, retryable: false, reason: 'blocked' });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'github',
        hasChanges: true,
        editedPaths: ['scripts/tool.mjs'],
        messages: [
          toolMsg('edit', { path: 'scripts/tool.mjs' }, { createdAt: 100 }),
          toolMsg('bash', { command: 'node scripts/tool.mjs' }, { result: 'OK', createdAt: 200 }),
          toolMsg(
            'bash',
            { command: 'git push' },
            { result: 'fatal: Authentication failed', isError: true, createdAt: 300 },
          ),
        ],
        attachments: [],
        stepIds: ['step-1'],
        unpushedCommits: 2,
      }),
    ).toMatchObject({ ok: false, retryable: false, reason: 'unpushed-blocked' });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'github',
        hasChanges: true,
        editedPaths: ['scripts/tool.mjs'],
        messages: [
          toolMsg('edit', { path: 'scripts/tool.mjs' }, { createdAt: 100 }),
          toolMsg('bash', { command: 'node scripts/tool.mjs' }, { result: 'OK', createdAt: 200 }),
        ],
        attachments: [],
        stepIds: ['step-1'],
        unpushedCommits: 1,
      }),
    ).toMatchObject({ ok: false, retryable: true, reason: 'unpushed' });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'github',
        hasChanges: true,
        editedPaths: ['scripts/tool.mjs'],
        messages: [
          toolMsg('edit', { path: 'scripts/tool.mjs' }, { createdAt: 100 }),
          toolMsg('bash', { command: 'node scripts/tool.mjs' }, { result: 'OK', createdAt: 200 }),
        ],
        attachments: [],
        stepIds: ['step-1'],
        unpushedCommits: null,
      }),
    ).toMatchObject({ ok: false, retryable: false, reason: 'unpushed-unknown' });

    expect(
      evaluateStepAcceptance({
        output: 'code',
        repoKind: 'github',
        hasChanges: true,
        editedPaths: ['scripts/tool.mjs'],
        messages: [
          toolMsg('edit', { path: 'scripts/tool.mjs' }, { createdAt: 100 }),
          toolMsg('bash', { command: 'node scripts/tool.mjs' }, { result: 'OK', createdAt: 200 }),
        ],
        attachments: [],
        stepIds: ['step-1'],
        unpushedCommits: undefined,
      }),
    ).toMatchObject({ ok: true });
  });

  test('extractEditedPathsFromMessages and prompt helpers work cleanly', () => {
    const msgs: AcceptanceMessage[] = [
      toolMsg('edit_file', { path: 'apps/web/src/Button.tsx' }, { createdAt: 1 }),
      toolMsg(
        'apply_patch',
        { patchText: '*** Begin Patch\n*** Update File: apps/server/src/index.ts\n*** End Patch' },
        { createdAt: 2 },
      ),
    ];
    expect(extractEditedPathsFromMessages(msgs)).toEqual([
      'apps/web/src/Button.tsx',
      'apps/server/src/index.ts',
    ]);
    const prompt = buildAcceptanceNudgePrompt({
      ok: false,
      retryable: true,
      reason: 'missing-ui-screenshot',
      checksRan: ['playwright'],
      summary: 'Missing live UI screenshot.',
      missing: 'Attach a live screenshot.',
      unblockHint: 'Run the app and call attach_file.',
    });
    expect(isAcceptanceNudgePrompt(prompt)).toBe(true);
    expect(isAcceptanceNudgePrompt('ordinary text')).toBe(false);
  });
});
