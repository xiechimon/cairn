import { describe, expect, test } from 'vitest';
import { SPIRAL_MAX_PROJECTS, spiralProjects } from '../src/board/home-spiral.js';
import { hangPositions } from '../src/components/ink-spiral.js';

describe('hangPositions', () => {
  test('nothing to hang gives no positions', () => {
    expect(hangPositions(0)).toEqual([]);
  });

  test('one project sits on the outer arm, short of the tail', () => {
    expect(hangPositions(1)).toEqual([0.8]);
  });

  test('several projects spread along the outer arm in order and stay off the tail', () => {
    const at = hangPositions(SPIRAL_MAX_PROJECTS);
    expect(at).toHaveLength(SPIRAL_MAX_PROJECTS);
    expect(at[0]).toBeCloseTo(0.52);
    expect(at.at(-1)).toBeCloseTo(0.9);
    for (let i = 1; i < at.length; i += 1) expect(at[i]).toBeGreaterThan(at[i - 1] ?? 0);
    expect(Math.max(...at)).toBeLessThan(1);
  });
});

describe('spiralProjects', () => {
  const projects = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `Project ${i}` }));

  test('projects waiting on the owner come first and the rest keep their order', () => {
    const picked = spiralProjects(projects, new Set(['p5', 'p2']));
    expect(picked.map((project) => project.id)).toEqual(['p2', 'p5', 'p0', 'p1', 'p3', 'p4']);
  });

  test('the spiral holds at most six projects', () => {
    expect(spiralProjects(projects, new Set())).toHaveLength(SPIRAL_MAX_PROJECTS);
  });

  test('a team with no projects hangs nothing but the new-project tail', () => {
    expect(spiralProjects([], new Set())).toEqual([]);
  });
});
