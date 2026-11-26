import { PICKED_PROJECT_OPEN } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { splitPreviousSummary } from '../src/coordinator/runtime/compaction.js';
import { titleClosesAnIssue } from '../src/services/build-github-merge.js';
import { slugifyRepoName } from '../src/services/git.js';
import { hasCheckPointerText } from '../src/services/memory-corrections.js';
import { canonicalModelId } from '../src/services/merge-gate/model-identity.js';
import { pickedProjectIdOf } from '../src/services/picked-project.js';
import { planHasOpenDecisions } from '../src/services/plan-decisions.js';

const BOUND_MS = 1_500;
const N = 160_000;

function userTurn(content: string): Parameters<typeof splitPreviousSummary>[0] {
  return [{ role: 'user', content, timestamp: 0 }];
}

const hostile: [string, () => unknown][] = [
  ['unclosed summary blocks', () => splitPreviousSummary(userTurn('<summary>\n'.repeat(N / 3)))],
  ['merge title keywords', () => titleClosesAnIssue('fix:'.repeat(N / 4))],
  ['repository slug dots', () => slugifyRepoName(`a${'.'.repeat(N)}x`)],
  ['model tag', () => canonicalModelId(`${'['.repeat(N)}x`)],
  ['picked project', () => pickedProjectIdOf(`${PICKED_PROJECT_OPEN}${'（id: '.repeat(N / 4)}`)],
  ['plan heading', () => planHasOpenDecisions(`## a${' '.repeat(N)}x`)],
  ['check pointer', () => hasCheckPointerText('(todo:'.repeat(15_000))],
  ['empty check pointers', () => hasCheckPointerText('(todo:)'.repeat(15_000))],
];

describe('server parsers stay linear on hostile text', () => {
  test.each(hostile)(
    '%s',
    (_name, run) => {
      const started = performance.now();
      run();
      expect(performance.now() - started).toBeLessThan(BOUND_MS);
    },
    300_000,
  );

  test.each([
    ['(check: [Add lint](todo:todo-existing))', true],
    ['(todo:(todo:nested))', true],
    ['(todo:(todo:))', true],
    ['(todo:)(todo:x)', true],
    ['(TODO:a b)', true],
    ['(todo:)', false],
    ['(todo:))', false],
    ['(todo:never closed', false],
  ])('a rule that points at a check task is recognised: %s', (rule, pointed) => {
    expect(hasCheckPointerText(rule)).toBe(pointed);
  });

  test.each([
    ['fix: #12 parser', true],
    ['Closes owner/repo#7', true],
    ['resolved :  JIRA-42', true],
    ['fix:2', true],
    ['fix:fix:3', true],
    ['prefix 12', false],
    ['fix: the parser in v2', false],
    ['close :', false],
    ['tidy the docs', false],
  ])('a merge title that would close an issue is recognised: %s', (title, closes) => {
    expect(titleClosesAnIssue(title)).toBe(closes);
  });
});
