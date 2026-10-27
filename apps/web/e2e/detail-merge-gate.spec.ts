import { expect, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

const task = {
  id: 'gate-task', teamId: 'gate-team', projectId: 'gate-project', title: 'Merge gate task',
  spec: '', phase: 'review', phaseAt: 0, seqNum: 1, orderIndex: 0, tagIds: [],
  assignment: null, agent: null, latestBuildId: 'gate-build', lastRunAt: 0,
  hasChanges: true, hasPlan: false, buildHistory: [], sourceTodo: null, v: 1,
};

test('task detail refreshes a gate verdict without reloading the page', async ({ page }) => {
  let gateReads = 0;
  await page.route('**/api/**', (route) => route.fulfill({ status: 500, json: { error: 'Unstubbed endpoint' } }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: {
    id: 'gate-user', displayName: 'Owner', avatarUrl: null,
  } }));
  await page.route('**/api/teams', (route) => route.fulfill({ json: [{
    id: 'gate-team', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null,
  }] }));
  await page.route('**/api/teams/gate-team/notifications', (route) => route.fulfill({ json: {
    unreadThreadIds: [],
  } }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [{
    id: 'gate-project', teamId: 'gate-team', name: 'Gate project', repoKind: 'github',
    repoName: null, githubRepo: 'example/repo', localPath: null,
  }] }));
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [task] }));
  await page.route('**/api/todos/gate-task', (route) => route.fulfill({ json: task }));
  await page.route('**/api/builds/gate-build', (route) => route.fulfill({ json: {
    id: 'gate-build', todoId: task.id, withPlan: false, prevPhase: null, triggerSource: 'user',
    planDocId: null, errorMessage: null, prUrl: 'https://github.com/example/repo/pull/1',
    prNumber: 1, diffHash: null, createdAt: 0,
  } }));
  await page.route('**/api/builds/gate-build/steps', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/builds/gate-build/plans', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/builds/gate-build/usage', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/builds/gate-build/changes', (route) => route.fulfill({ json: { files: [] } }));
  await page.route('**/api/conversations/gate-build/messages', (route) => route.fulfill({ json: {
    messages: [], chips: [], historyEpoch: 0, steerPending: [], activeRun: null, nextCursor: null,
  } }));
  await page.route('**/api/builds/gate-build/gate', (route) => {
    gateReads += 1;
    return route.fulfill({ json: { state: {
      ready: gateReads > 1, headSha: 'a'.repeat(40), patchDigest: 'sha256:gate',
      policy: 'autonomous', evaluatedAt: gateReads,
      blockers: gateReads > 1 ? [] : [{
        code: 'decision-missing', class: 'transient', label: 'Chief decision pending', detail: [],
      }],
    } } });
  });
  await page.goto('/app/todo/gate-task');
  const gate = page.getByTestId('merge-gate-verdict');
  await expect(gate).toContainText('decision-missing');
  await evidencePanelShot(page, 'gate-blocked.png', gate);
  await expect(gate).not.toContainText('decision-missing', { timeout: 10_000 });
  await expect(gate).toBeVisible();
  expect(gateReads).toBeGreaterThan(1);
  await evidencePanelShot(page, 'gate-ready.png', gate);
});
