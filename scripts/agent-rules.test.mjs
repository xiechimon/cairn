import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

test('AGENTS.md lands work through queue/main without force and keeps the deploy as the safety net', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /^## Ship$/m);
  assert.ok(agents.includes('`node scripts/ops/push-queue.mjs`'));
  assert.match(agents, /green-main` ruleset/);
  assert.match(agents, /Push without force/);
  assert.match(agents, /published by the `desktop-release` workflow, a level-triggered poller/);
  assert.match(
    agents,
    /resolve it so both sides. intent survives, rerun step 4, and push without asking/,
  );
  assert.match(agents, /watch CI on your commit/);
});

test('AGENTS.md uses the speculative batching queue, retries once, and never lets an agent delete queued refs', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /speculative `refs\/heads\/queue\/try\/<id>` branches up to depth 4/);
  assert.match(agents, /rerun once/);
  assert.match(agents, /cancelled jobs alone count/);
  assert.match(agents, /`Lane: <machine id>\/<worktree>` trailer/);
  assert.match(agents, /never write a loop that deletes or recreates `queue\/main`/);
  assert.match(agents, /you never remove one, not even one you think is yours or dead/);
  assert.match(agents, /whatever tool made the commits \(Amp, Claude Code, a Cairn task/);
  assert.doesNotMatch(agents, /delete your own dead candidate/);
});

test('AGENTS.md keeps the safety rules the ship flow relies on', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /Never force push/);
  assert.match(
    agents,
    /Plan gate \(`docs\/ops\/plan-gate\.md`, enforced by `scripts\/plan-gate\.mjs`\)/,
  );
  assert.match(agents, /No change may edit what judges it/);
});

test('active guidance no longer routes work through the retired merge ceremony', () => {
  for (const file of [
    'AGENTS.md',
    '.claude/skills/pr-cairn/SKILL.md',
    'docs/ops/agent-bot-identity.md',
  ]) {
    const guidance = read(file);
    assert.doesNotMatch(
      guidance,
      /needs-decision|merge-route|pr-evidence|Mergify Merge Queue|autonomy brake|pr-assets\/<|mergedBy: 'auto-merge'/i,
      file,
    );
  }
});

test('no rule or brief spells out the focused Codex review command; the server builds it', () => {
  for (const file of [
    'AGENTS.md',
    'docs/agent-dispatch-prompts.md',
    '.claude/skills/pr-cairn/SKILL.md',
    'docs/research/pr-flow-speed-2026-11-09.md',
  ])
    assert.doesNotMatch(read(file), /@codex review for/, file);
});

test('AGENTS.md Ship requires post-landing production verification (done = verified in production)', () => {
  const agents = read('AGENTS.md');
  const ship = agents.match(/^## Ship\n([\s\S]*?)^## /m)?.[1] ?? '';
  assert.ok(ship.includes('done = verified in production'));
  assert.match(ship, /cairn-server.*cairn-runner/);
  assert.match(ship, /git merge-base --is-ancestor <landed-sha> <deployed-sha>/);
  assert.match(ship, /agent-passage\.mjs health --target prod --expect-sha <landed-sha>/);
  assert.match(ship, /agent-passage\.mjs top-journeys --target prod --live/);
  assert.match(ship, /http:\/\/127\.0\.0\.1:8787\/app/);
  assert.match(ship, /archive or delete any synthetic verification project, task, or comment/i);
  assert.match(ship, /keep the verification evidence/i);
});
