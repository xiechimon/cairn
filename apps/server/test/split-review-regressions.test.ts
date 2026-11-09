import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { team } from '../src/db/schema.js';
import { homeMachineRejectReason } from '../src/services/dispatch-eligibility.js';
import { bootServer, req, teamPausedForTest } from './helpers.js';

const selectedModel = { provider: 'claude-code', modelId: 'selected' };

test.each([
  null,
  { installed: false, hostname: 'test', models: [{ id: 'selected', name: 'Selected' }] },
  { installed: true, hostname: 'test', models: [] },
])('home gate rejects unavailable selected Claude model with report %j', (report) => {
  const home = {
    name: 'test',
    enabledRuntimes: ['claude-code'],
    claudeCodeReport: report,
  };
  expect(homeMachineRejectReason(home, selectedModel)).not.toBeNull();
});

test('pause-only PATCH preserves every first-PR field, including dismissal and recorded first PR', async () => {
  const s = bootServer();
  try {
    const fields = {
      firstPrReportPromptEnabled: true,
      firstPrReportPromptDismissedAt: 1234,
      firstPrReportPromptFirstPrAt: 2345,
      firstPrReportPromptFirstPrNumber: 7,
    };
    s.db.update(team).set(fields).where(eq(team.id, s.team.id)).run();
    const before = s.db.select().from(team).where(eq(team.id, s.team.id)).get()!;
    expect(
      (await req(s.app, 'PATCH', `/api/teams/${s.team.id}`, { autonomyPaused: true })).status,
    ).toBe(200);
    expect(s.db.select().from(team).where(eq(team.id, s.team.id)).get()).toEqual({
      ...before,
    });
    expect(teamPausedForTest(s.db, s.team.id)).toBe(true);
  } finally {
    s.dispose();
  }
});

test('home gate follows the model catalog liveness decision', () => {
  const catalog = [{ id: 'selected', liveness: 'dead' as const }];
  const home = {
    name: 'test',
    enabledRuntimes: ['claude-code'],
    claudeCodeReport: {
      installed: true,
      hostname: 'test',
      models: [{ id: 'selected', name: 'Selected' }],
    },
  };
  expect(homeMachineRejectReason(home, selectedModel, catalog)).not.toBeNull();
});

test('an available selected Claude model passes the home gate', () => {
  const home = {
    name: 'test',
    enabledRuntimes: ['claude-code'],
    claudeCodeReport: {
      installed: true,
      hostname: 'test',
      models: [{ id: 'selected', name: 'Selected' }],
    },
  };
  expect(homeMachineRejectReason(home, selectedModel)).toBeNull();
});
