import { describe, expect, it } from 'vitest';
import {
  buildSkillEntry,
  parseSkillFrontmatter,
  SKILL_DIR_NAME_RE,
  splitSkillEntry,
} from '../src/index.js';

describe('SKILL_DIR_NAME_RE (directory-name safety domain)', () => {
  it('accepts normal names', () => {
    for (const ok of ['deploy', 'a', 'A1', 'my-skill', 'my.skill', 'my_skill', 'x'.repeat(64)]) {
      expect(SKILL_DIR_NAME_RE.test(ok)).toBe(true);
    }
  });
  it('reject: empty / non-alphanumeric start / illegal chars / over 64 / path segments', () => {
    for (const bad of ['', '-lead', '.lead', '_lead', 'a b', 'a/b', 'a\\b', '中', 'x'.repeat(65)]) {
      expect(SKILL_DIR_NAME_RE.test(bad)).toBe(false);
    }
  });
});

describe('parseSkillFrontmatter (lifted from server, semantics unchanged)', () => {
  it('parses single-line name/description', () => {
    expect(parseSkillFrontmatter('---\nname: a\ndescription: b\n---\n')).toEqual({
      name: 'a',
      description: 'b',
    });
  });
  it('no frontmatter block -> empty object', () => {
    expect(parseSkillFrontmatter('no frontmatter')).toEqual({});
  });
  it('quoted values stripped of quotes; folded block scalars not accepted', () => {
    expect(parseSkillFrontmatter('---\nname: "quoted"\n---\n')).toEqual({ name: 'quoted' });
    expect(parseSkillFrontmatter('---\ndescription: >\n---\n')).toEqual({});
  });
});

describe('buildSkillEntry ↔ splitSkillEntry round-trip', () => {
  it('assembled product reads back: name/description identical field by field, body preserved', () => {
    const content = buildSkillEntry('deploy', '部署流程手册', '# 步骤\n\n1. 构建\n2. 发布\n');
    const split = splitSkillEntry(content);
    expect(split.name).toBe('deploy');
    expect(split.description).toBe('部署流程手册');
    expect(split.body).toBe('# 步骤\n\n1. 构建\n2. 发布\n');
  });

  it('empty body: frontmatter complete, body empty string', () => {
    const split = splitSkillEntry(buildSkillEntry('a', 'b', ''));
    expect(split).toEqual({ name: 'a', description: 'b', body: '' });
  });

  it('leading/trailing whitespace in the body normalized (edit write-back does not flicker)', () => {
    const split = splitSkillEntry(buildSkillEntry('a', 'b', '\n\n  正文  \n\n'));
    expect(split.body).toBe('正文\n');
  });

  it('split accepts existing on-disk files (frontmatter + body separated verbatim)', () => {
    const split = splitSkillEntry('---\nname: x\ndescription: y\n---\n\nhello\n');
    expect(split).toEqual({ name: 'x', description: 'y', body: 'hello\n' });
  });

  it('split without frontmatter -> everything goes to body (same rule as the parseSkillFrontmatter empty case)', () => {
    expect(splitSkillEntry('# 直接正文\n')).toEqual({ body: '# 直接正文\n' });
  });

  it('quoted description round-trip failure (the shape the client pre-check must block)', () => {
    const split = splitSkillEntry(buildSkillEntry('a', '"quoted"', ''));
    expect(split.description).toBe('quoted');
  });
});
