import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

test('AGENTS.md ships straight to main without force and keeps the deploy as the safety net', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /^## Ship$/m);
  assert.ok(agents.includes('`git push origin HEAD:main`'));
  assert.match(agents, /Push without force/);
  assert.match(
    agents,
    /deploys only main commits whose `check`, `pack-smoke` and `e2e-gate` runs are green/,
  );
  assert.match(
    agents,
    /A failing test is not yours only after it fails on `origin\/main` without your change/,
  );
  assert.match(agents, /stop and ask ian before pushing/);
  assert.match(agents, /Watch CI on the commit you pushed/);
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
