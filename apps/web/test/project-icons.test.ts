import {
  PROJECT_ICON_KEYWORDS,
  PROJECT_ICONS,
  projectIconForName,
  projectIconOrAuto,
  searchProjectIcons,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PROJECT_ICON_COMPONENTS } from '../src/board/project-icon-map.js';

describe('PROJECT_ICONS', () => {
  test('every icon has a component and search keywords', () => {
    for (const name of PROJECT_ICONS) {
      expect(PROJECT_ICON_COMPONENTS[name], name).toBeDefined();
      expect(PROJECT_ICON_KEYWORDS[name].length, name).toBeGreaterThan(0);
    }
  });
});

describe('projectIconForName', () => {
  test('gives one name the same icon every time, from the icon list', () => {
    expect(projectIconForName('cairn')).toBe(projectIconForName('cairn'));
    for (const name of ['cairn', '我的应用', 'web-app', '👾 lab', ''])
      expect(PROJECT_ICONS).toContain(projectIconForName(name));
  });

  test.each([
    ['cairn', 'lightbulb'],
    ['我的应用', 'laptop'],
    ['atlas', 'medal'],
    ['web-app', 'file-code'],
  ])('keeps the icon %j had (%s); the list is append-only so hashes stay put', (name, icon) => {
    expect(projectIconForName(name)).toBe(icon);
  });
});

describe('projectIconOrAuto', () => {
  test('a picked icon wins; an unpicked name derives; no name falls back to box', () => {
    expect(projectIconOrAuto('rocket', 'cairn')).toBe('rocket');
    expect(projectIconOrAuto(null, 'cairn')).toBe('lightbulb');
    expect(projectIconOrAuto(undefined, '  cairn  ')).toBe('lightbulb');
    expect(projectIconOrAuto(null, '')).toBe('box');
    expect(projectIconOrAuto(null, '   ')).toBe('box');
    expect(projectIconOrAuto(null, undefined)).toBe('box');
  });
});

describe('searchProjectIcons', () => {
  test('an empty query lists every icon', () => {
    expect(searchProjectIcons('')).toEqual([...PROJECT_ICONS]);
    expect(searchProjectIcons('  ')).toEqual([...PROJECT_ICONS]);
  });

  test('matches on the kebab name, on an English keyword, and on a Chinese keyword', () => {
    expect(searchProjectIcons('rock')).toEqual(['rocket']);
    expect(searchProjectIcons('launch')).toEqual(['rocket']);
    expect(searchProjectIcons('火箭')).toEqual(['rocket']);
    expect(searchProjectIcons('数据')).toEqual(['database']);
  });

  test('spaces in the query read as kebab separators and a miss is empty', () => {
    expect(searchProjectIcons('git fork')).toEqual(['git-fork']);
    expect(searchProjectIcons('zzzz')).toEqual([]);
  });
});
