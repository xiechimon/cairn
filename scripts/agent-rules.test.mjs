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
          `- Both paths require a pr-gate go with \`mergedBy: 'auto-merge'\` (path class does not route to ian), ${tasks} and no \`needs-decision\` label. After merging, verify the resulting main commit's author and its \`commit-author\` Actions result.`,
        ),
      file,
    );
  }
  const retro = readFileSync(join(ROOT, '.claude/skills/retro-cairn/SKILL.md'), 'utf8');
  assert.ok(!retro.includes('open auto-merge'), '.claude/skills/retro-cairn/SKILL.md');
  assert.ok(retro.includes("mergedBy: 'auto-merge'"), '.claude/skills/retro-cairn/SKILL.md');
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /pr-gate[^\n]*go[^\n]*`mergedBy: 'auto-merge'`/);
  assert.match(agents, /Protected-path PRs enter the merge queue/);
  assert.match(agents, /Protected paths require Codex cloud code review on the PR head/);
  assert.ok(!agents.includes('codex exec` from Claude'));
});

test('the security review is not part of the merge route', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Codex security review is no longer part of the merge route/);
  assert.doesNotMatch(agents, /Codex `security_review` state on the exact head/);
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

test('agents admin-merge only a PR ian named in chat', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(
    agents,
    /When ian authorizes a named PR on his route in chat, an agent may merge it with `gh pr merge <n> --admin`, using the merge method `docs\/ops\/agent-bot-identity.md` gives its opener/,
  );
  assert.match(agents, /Without that per-PR authorization, agents never use `--admin`\./);
  const skill = readFileSync(join(ROOT, '.claude/skills/pr-cairn/SKILL.md'), 'utf8');
  assert.match(skill, /an agent uses `--admin` only on a PR ian named in chat/);
});
