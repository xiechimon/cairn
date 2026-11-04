import { describe, expect, test } from 'vitest';
import { suggestProjects } from '../src/board/project-suggestions.js';

const project = (name: string, lastActiveAt = 0) => ({ id: `id-${name}`, name, lastActiveAt });

const PROJECTS = [
  project('docs-site', 30),
  project('cairn', 10),
  project('relay', 50),
  project('cairn-web', 20),
  project('orb', 40),
];

const names = (unknownId: string, projects = PROJECTS, limit?: number) =>
  suggestProjects(unknownId, projects, limit).projects.map((p) => p.name);

describe('suggestProjects', () => {
  test('a name contained in the unknown id is suggested and unrelated ones are not', () => {
    const { projects, kind } = suggestProjects('cairn-old', PROJECTS);
    expect(kind).toBe('close');
    expect(projects.map((p) => p.name)).toEqual(['cairn']);
  });

  test('a swapped pair of letters is close', () => {
    expect(names('realy')).toEqual(['relay']);
  });

  test('matching ignores case and punctuation', () => {
    expect(names('Docs_Site')).toEqual(['docs-site']);
  });

  test('exact beats containing, which beats edit distance', () => {
    const list = [project('relay', 99), project('realyx', 2), project('realy', 1)];
    expect(names('realy', list)).toEqual(['realy', 'realyx', 'relay']);
  });

  test('close matches are capped at the limit', () => {
    const list = ['a-web', 'b-web', 'c-web', 'd-web'].map((n, i) => project(n, i));
    expect(names('web', list)).toHaveLength(3);
    expect(names('web', list, 2)).toHaveLength(2);
  });

  test('nothing close falls back to the most recently active projects', () => {
    const { projects, kind } = suggestProjects('zzzzzzzz', PROJECTS);
    expect(kind).toBe('recent');
    expect(projects.map((p) => p.name)).toEqual(['relay', 'orb', 'docs-site']);
  });

  test('an id with no letters falls back to recent instead of matching everything', () => {
    const { kind } = suggestProjects('---', PROJECTS);
    expect(kind).toBe('recent');
  });

  test('no projects yields no suggestions', () => {
    expect(suggestProjects('cairn', [])).toEqual({ projects: [], kind: 'recent' });
  });

  test('oversized URL values fall back to recent without matching a short embedded name', () => {
    const value = `${'x'.repeat(100_000)}cairn`;
    const result = suggestProjects(value, PROJECTS);
    expect(result.kind).toBe('recent');
    expect(result.projects.map((p) => p.name)).toEqual(['relay', 'orb', 'docs-site']);
  });

  test('oversized project names cannot become fuzzy or substring matches', () => {
    const oversized = project(`cairn${'x'.repeat(100_000)}`, 1);
    const exact = project('cairn', 2);
    expect(suggestProjects('cairn', [oversized, exact])).toEqual({
      kind: 'close',
      projects: [exact],
    });
  });

  test('the 256-character matching limit is inclusive and raw punctuation counts toward it', () => {
    const target = 'a'.repeat(256);
    const exact = project(target);
    expect(suggestProjects(target, [exact]).kind).toBe('close');
    expect(suggestProjects(`${target}-`, [exact]).kind).toBe('recent');
    expect(suggestProjects(`cairn${'-'.repeat(252)}`, PROJECTS).kind).toBe('recent');
  });

  test('long similar project names retain adjacent-transposition matching', () => {
    const prefix = 'a'.repeat(250);
    const adjacent = project(`${prefix}bcde`);
    const distant = project('z'.repeat(254), 5);
    const result = suggestProjects(`${prefix}bdce`, [distant, adjacent]);
    expect(result.kind).toBe('close');
    expect(result.projects).toEqual([adjacent]);
  });

  test('a large length difference is not a fuzzy match', () => {
    const short = project('relay');
    const long = project('x'.repeat(256), 2);
    expect(suggestProjects('r'.repeat(256), [short, long]).kind).toBe('recent');
  });

  test('a one or two letter id does not substring-match', () => {
    const { kind } = suggestProjects('a', [project('cairn')]);
    expect(kind).toBe('recent');
  });
});
