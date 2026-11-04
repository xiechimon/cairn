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

  test('a one or two letter id does not substring-match', () => {
    const { kind } = suggestProjects('a', [project('cairn')]);
    expect(kind).toBe('recent');
  });
});
