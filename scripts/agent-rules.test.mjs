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
          `- Both paths require a pr-gate go with \`mergedBy: 'auto-merge'\` (every other PR goes to ian), ${tasks} and no \`needs-decision\` label. After merging, verify the resulting main commit's author and its \`commit-author\` Actions result.`,
        ),
      file,
    );
  }
  const retro = readFileSync(join(ROOT, '.claude/skills/retro-cairn/SKILL.md'), 'utf8');
  assert.ok(!retro.includes('open auto-merge'), '.claude/skills/retro-cairn/SKILL.md');
  assert.ok(retro.includes("mergedBy: 'auto-merge'"), '.claude/skills/retro-cairn/SKILL.md');
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /pr-gate[^\n]*go[^\n]*`mergedBy: 'auto-merge'`/);
  assert.match(agents, /protected-path PRs[^\n]*go to ian/i);
  assert.match(agents, /Protected paths require Codex cloud code review on the PR head/);
  assert.ok(!agents.includes('codex exec` from Claude'));
});

test('canonical security guidance requires exact-head clean Codex SECURITY state without a Claude rerun', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Codex `security_review` state on the exact head/);
  assert.match(agents, /`status=completed` and `has_unresolved_findings=false`/);
  assert.match(agents, /plus green CI and `review-gate` SUCCESS/);
  assert.match(agents, /resolve every security finding regardless of severity/);
  assert.match(agents, /no later Claude rerun is required/);
  assert.match(
    agents,
    /D88 permits an explicitly null unresolved field only with a trusted fresh clean SECURITY receipt/,
  );
  assert.match(agents, /zero unresolved security-review threads at every severity/);
  assert.match(agents, /Missing fields, malformed values and explicit true stay blocked/);
  assert.match(agents, /ordinary code review alone is insufficient/);
  assert.doesNotMatch(agents, /Run `\/security-review`|plus `\/security-review`/);
});

test('AGENTS.md and pr-cairn agree that agents never add needs-decision', () => {
  for (const file of ['AGENTS.md', '.claude/skills/pr-cairn/SKILL.md']) {
    const guidance = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(!guidance.includes('--add-label needs-decision'), file);
    assert.match(guidance, /[Nn]ever add the `needs-decision` label/, file);
    assert.match(guidance, /decide by [^\n]*recommendation[^\n]*say [^\n]*chat/i, file);
    assert.ok(guidance.includes('gh pr merge <n> --disable-auto'), file);
    assert.ok(guidance.includes("mergedBy: 'auto-merge'"), file);
  }
});

test('active docs never tell agents to add needs-decision', () => {
  for (const file of [
    'AGENTS.md',
    '.claude/skills/pr-cairn/SKILL.md',
    'docs/pr-review.md',
    'docs/spec/28-bootstrap-closed-loop-self-authored-self-merged.md',
  ]) {
    const guidance = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(!guidance.includes('--add-label needs-decision'), file);
    assert.doesNotMatch(guidance, /(?<![Nn]ever )\badd(?:s|ing)? (?:the )?`needs-decision`/, file);
  }
});
