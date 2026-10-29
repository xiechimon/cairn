import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

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
