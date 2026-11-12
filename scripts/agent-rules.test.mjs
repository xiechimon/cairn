import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

test('merge instructions require the pr-gate auto-merge verdict', () => {
  for (const [file, tasks] of [
    ['docs/ops/agent-bot-identity.md', 'no unchecked tasks anywhere in the body'],
  ]) {
    const guidance = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(
      guidance
        .split('\n')
        .includes(
          `- Both paths require a pr-gate go with \`mergedBy: 'auto-merge'\` (only CI and merge machinery, the eval ruler, and the credentials, machine and external-entry lists route to ian), ${tasks} and no \`coordinator-hold\` label. After merging, verify the resulting main commit's author and its \`commit-author\` Actions result.`,
        ),
      file,
    );
  }
  const retro = readFileSync(join(ROOT, '.claude/skills/retro-cairn/SKILL.md'), 'utf8');
  assert.ok(!retro.includes('open auto-merge'), '.claude/skills/retro-cairn/SKILL.md');
  assert.ok(retro.includes("mergedBy: 'auto-merge'"), '.claude/skills/retro-cairn/SKILL.md');
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /pr-gate[^\n]*go[^\n]*`mergedBy: 'auto-merge'`/);
  assert.match(agents, /other protected paths, enters the merge queue/);
  assert.match(agents, /Protected paths require Codex cloud code review on the PR head/);
  assert.ok(!agents.includes('codex exec` from Claude'));
});

test('security surfaces need a recorded review and the three lists route to ian', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /\/security-review/);
  assert.match(agents, /fixed or recorded/);
  assert.match(agents, /`pr-evidence` fails without that line/);
  assert.match(agents, /route to ian/);
  assert.match(agents, /does not add `coordinator-hold`/);
  assert.match(agents, /cairnwright\[bot\]` author uses the bot queue/);
  assert.doesNotMatch(agents, /Codex `security_review` state on the exact head/);
  assert.doesNotMatch(agents, /still mark protected paths for routing and ownership/);
  assert.doesNotMatch(agents, /no separate security approval is required/);
  assert.doesNotMatch(agents, /which are owner-routed/);
});

test('AGENTS.md and pr-cairn agree that coordinator-hold is the only hold label', () => {
  for (const file of ['AGENTS.md', '.claude/skills/pr-cairn/SKILL.md']) {
    const guidance = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(!guidance.includes('needs-decision'), file);
    assert.match(guidance, /decide by [^\n]*recommendation[^\n]*say [^\n]*chat/i, file);
    assert.ok(guidance.includes('gh pr merge <n> --disable-auto'), file);
    assert.ok(guidance.includes("mergedBy: 'auto-merge'"), file);
  }
});

test('active docs never mention the retired needs-decision label', () => {
  for (const file of [
    'AGENTS.md',
    '.claude/skills/pr-cairn/SKILL.md',
    'docs/pr-review.md',
    'docs/ops/agent-bot-identity.md',
  ]) {
    const guidance = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(!guidance.includes('needs-decision'), file);
  }
});

test('agents admin-merge only a PR ian named in chat', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(
    agents,
    /When ian authorizes a named PR on his route in chat, an agent may merge it with `gh pr merge <n> --admin --squash`, whoever opened it,/,
  );
  assert.match(agents, /Without that per-PR authorization, agents never use `--admin`\./);
  const skill = readFileSync(join(ROOT, '.claude/skills/pr-cairn/SKILL.md'), 'utf8');
  assert.match(skill, /an agent uses `--admin` only on a PR ian named in chat/);
});

test('the review rules use the heading Codex reads and agree with the thread gate', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /^## Code Review Rules$/m);
  assert.doesNotMatch(agents, /^## Review guidelines$/m);
  assert.doesNotMatch(agents, /P2\/P3 findings do not block/);
  assert.match(agents, /#review-threads-unresolved = 0/);
  assert.match(agents, /P0\/P1 findings must be fixed/);
  assert.match(agents, /`valid, out of scope for this PR, tracked in #N`/);
  assert.match(agents, /Never post Mergify commands/);
  assert.match(agents, /Do not open a PR whose base is another open PR's branch/);
  assert.match(agents, /Design first for a change to persisted state/);
});

test('no rule or brief spells out the focused Codex review command; the server builds it', () => {
  for (const file of [
    'AGENTS.md',
    'docs/agent-dispatch-prompts.md',
    '.claude/skills/pr-cairn/SKILL.md',
    'docs/research/pr-flow-speed-2026-11-09.md',
  ])
    assert.doesNotMatch(readFileSync(join(ROOT, file), 'utf8'), /@codex review for/, file);
});
