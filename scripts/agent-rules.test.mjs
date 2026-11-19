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
  assert.ok(agents.includes('`git push origin HEAD:queue/main`'));
  assert.match(agents, /green-main` ruleset/);
  assert.match(agents, /Push without force/);
  assert.match(
    agents,
    /published by the `desktop-release` workflow on every push whose app sources moved/,
  );
  assert.match(
    agents,
    /resolve it so both sides. intent survives, rerun step 4, and push without asking/,
  );
  assert.match(agents, /watch CI on your commit/);
});

test('AGENTS.md holds one candidate on queue/main and drops a candidate that fails twice', () => {
  const agents = read('AGENTS.md');
  assert.ok(agents.includes('`node scripts/ops/push-queue.mjs`'));
  assert.match(agents, /holds one candidate at a time/);
  assert.match(agents, /rerun once/);
  assert.match(agents, /cancelled jobs do not count/);
  assert.match(agents, /Consecutive commits with the same `Amp-Thread-ID` stay or go together/);
  assert.match(agents, /Never touch another lane's live candidate/);
});

test('AGENTS.md keeps the safety rules the ship flow relies on', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /Never force push/);
  assert.match(agents, /\/security-review/);
  assert.match(agents, /Design first for a change to persisted state/);
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
