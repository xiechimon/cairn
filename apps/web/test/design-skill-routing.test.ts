import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = new URL('../../../', import.meta.url).pathname;
const SKILLS = join(ROOT, '.claude/skills');

const JAKUB = '672ae44ace6aaed65b86cbb1e2fd6fbea0e79578';
const EMIL = '64eb3deb9a5fbfa041faf783e0bc3fd635872e9c';

const rulesDoc = readFileSync(join(ROOT, 'apps/web/DESIGN.md'), 'utf8');
const ruleIds = new Set(
  rulesDoc
    .split('\n')
    .map((line) => line.match(/^\| ([A-Z]+\d+) \|/)?.[1])
    .filter((id): id is string => Boolean(id)),
);

function section(text: string, heading: string): string {
  const rest = text.split(heading)[1] ?? '';
  return rest.split('\n## ')[0] ?? '';
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function wrapperText(skill: string): string {
  return readFileSync(join(SKILLS, skill, 'SKILL.md'), 'utf8');
}

const designCairn = wrapperText('design-cairn');
const routing = section(designCairn, '## Skill routing');
const routed = [
  ...new Set([...routing.matchAll(/`?(cairn-[a-z-]+)`?/g)].map((match) => match[1] ?? '')),
];

describe('no second SKILL.md is discoverable under a vendored tree', () => {
  test.each(['design-cairn', 'cairn-motion', 'cairn-polish', 'cairn-type', 'cairn-motion-audit'])(
    '%s',
    (skill) => {
      const dir = join(SKILLS, skill);
      const skillMds = walk(dir)
        .filter((path) => path.endsWith('SKILL.md'))
        .map((path) => path.slice(dir.length))
        .sort();
      expect(skillMds).toEqual(['/SKILL.md']);
    },
  );
});

describe('the design-cairn routing table', () => {
  test('names the domain skills and the audit', () => {
    expect(routed).toEqual(
      expect.arrayContaining(['cairn-motion', 'cairn-polish', 'cairn-type', 'cairn-motion-audit']),
    );
  });

  test.each(routed)('%s exists as a skill', (name) => {
    expect(existsSync(join(SKILLS, name, 'SKILL.md'))).toBe(true);
  });
});

const VENDORED: Record<
  string,
  { sha: string; repo: string; upstreamName: string; entry: string }
> = {
  'cairn-motion': {
    sha: JAKUB,
    repo: 'jakubkrehel/skills',
    upstreamName: 'better-motion',
    entry: 'upstream/README.md',
  },
  'cairn-polish': {
    sha: JAKUB,
    repo: 'jakubkrehel/skills',
    upstreamName: 'better-ui',
    entry: 'upstream/README.md',
  },
  'cairn-type': {
    sha: JAKUB,
    repo: 'jakubkrehel/skills',
    upstreamName: 'better-typography',
    entry: 'upstream/README.md',
  },
};

describe('vendored upstream skills', () => {
  for (const [skill, pin] of Object.entries(VENDORED)) {
    const dir = join(SKILLS, skill);
    const wrapper = wrapperText(skill);

    describe(skill, () => {
      test('carries the upstream LICENSE beside the vendored files', () => {
        expect(readFileSync(join(dir, 'upstream/LICENSE'), 'utf8')).toContain('MIT License');
      });

      test('notes the upstream repo and commit', () => {
        expect(wrapper).toContain(`${pin.repo}@${pin.sha}`);
      });

      test('the vendored entry file is the real upstream SKILL.md', () => {
        expect(readFileSync(join(dir, pin.entry), 'utf8')).toContain(`name: ${pin.upstreamName}`);
      });

      test('the override table names only rule ids that exist in the DESIGN.md rule index', () => {
        const overrides = section(wrapper, '## Cairn overrides');
        expect(overrides).toContain('|---|');
        const ids = new Set(
          [...overrides.matchAll(/\b([PCVTARL]\d+)\b/g)].map((match) => match[1] ?? ''),
        );
        expect(ids.size).toBeGreaterThan(0);
        expect([...ids].filter((id) => !ruleIds.has(id))).toEqual([]);
      });
    });
  }

  test('cairn-motion carries the emil reference files, license and pin', () => {
    const dir = join(SKILLS, 'cairn-motion');
    expect(wrapperText('cairn-motion')).toContain(`emilkowalski/skills@${EMIL}`);
    expect(readFileSync(join(dir, 'references/LICENSE'), 'utf8')).toContain('MIT License');
    for (const file of [
      'references/choreograph/README.md',
      'references/choreograph/RECIPES.md',
      'references/animation-performance/README.md',
    ]) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }
  });
});

describe('cairn-motion-audit', () => {
  const dir = join(SKILLS, 'cairn-motion-audit');
  const audit = wrapperText('cairn-motion-audit');

  test('stays manually invoked', () => {
    expect(audit).toContain('disable-model-invocation: true');
  });

  test('vendors the four emil review skills verbatim with LICENSE and pin', () => {
    expect(audit).toContain(`emilkowalski/skills@${EMIL}`);
    expect(readFileSync(join(dir, 'upstream/LICENSE'), 'utf8')).toContain('MIT License');
    for (const file of [
      'upstream/remove-animations/README.md',
      'upstream/find-animation-opportunities/README.md',
      'upstream/improve-animations/README.md',
      'upstream/improve-animations/AUDIT.md',
      'upstream/improve-animations/PLAN-TEMPLATE.md',
      'upstream/review-animations/README.md',
      'upstream/review-animations/STANDARDS.md',
    ]) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }
  });

  test('names only existing rule ids', () => {
    const ids = new Set([...audit.matchAll(/\b([PCVTARL]\d+)\b/g)].map((match) => match[1] ?? ''));
    expect(ids.size).toBeGreaterThan(0);
    expect([...ids].filter((id) => !ruleIds.has(id))).toEqual([]);
  });
});

describe('design-cairn vendored sources', () => {
  const dir = join(SKILLS, 'design-cairn');

  test('the extreme-data catalog is vendored verbatim with LICENSE and pin', () => {
    expect(designCairn).toContain(`emilkowalski/skills@${EMIL}`);
    expect(readFileSync(join(dir, 'upstream/break-ui/LICENSE'), 'utf8')).toContain('MIT License');
    const catalog = readFileSync(join(dir, 'upstream/break-ui/CATALOG.md'), 'utf8');
    expect(catalog).toContain('Worst-Case Catalog');
    expect(catalog).toContain('bartholomew.fitzgerald@northwind-industries-holdings.example.com');
  });
});
