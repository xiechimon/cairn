import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

test('merge instructions require the pr-gate auto-merge verdict', () => {
  for (const [file, tasks] of [
    ['AGENTS.md', 'no unchecked tasks anywhere in the body'],
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
});

test('AGENTS.md and pr-cairn agree that agents never add needs-decision', () => {
  for (const file of ['AGENTS.md', '.claude/skills/pr-cairn/SKILL.md']) {
    const guidance = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(!guidance.includes('--add-label needs-decision'), file);
    assert.match(guidance, /[Nn]ever add the `needs-decision` label/, file);
    assert.match(guidance, /already on[^\n]*keeps pr-evidence red and disarms auto-merge/, file);
    assert.match(
      guidance,
      /only payments, the owner's own credentials and the steps [^\n]*routes to a person go to the owner/,
      file,
    );
    assert.ok(guidance.includes('gh pr merge <n> --disable-auto'), file);
    assert.ok(guidance.includes("mergedBy: 'auto-merge'"), file);
    if (file === 'AGENTS.md') {
      assert.ok(guidance.includes('CAIRN_DECIDED=1'), file);
    }
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
