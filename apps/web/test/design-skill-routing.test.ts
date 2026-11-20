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
  ...new Set([...routing.matchAll(/`?(cairn-[a-z0-9-]+)`?/g)].map((match) => match[1] ?? '')),
];

describe('no second SKILL.md is discoverable under a vendored tree', () => {
  test.each([
    'design-cairn',
    'cairn-motion',
    'cairn-polish',
    'cairn-type',
    'cairn-a11y',
    'cairn-copy',
    'cairn-design-review',
    'cairn-motion-audit',
    'options-prototype-cairn',
    'retro-cairn',
  ])(
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
      expect.arrayContaining([
        'cairn-motion',
        'cairn-polish',
        'cairn-type',
        'cairn-a11y',
        'cairn-copy',
        'cairn-motion-audit',
        'cairn-design-review',
      ]),
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
  'cairn-a11y': {
    sha: JAKUB,
    repo: 'jakubkrehel/skills',
    upstreamName: 'better-accessibility',
    entry: 'upstream/README.md',
  },
  'cairn-copy': {
    sha: JAKUB,
    repo: 'jakubkrehel/skills',
    upstreamName: 'better-writing',
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

const TREES: Record<
  string,
  { pins: string[]; licenses: string[]; entries: string[]; files: string[] }
> = {
  'design-cairn': {
    pins: [`jakubkrehel/skills@${JAKUB}`],
    licenses: ['upstream/LICENSE', 'references/LICENSE'],
    entries: [
      'upstream/build-design/README.md',
      'upstream/explain-interface/README.md',
      'upstream/break/README.md',
      'references/pick-ui-library/README.md',
    ],
    files: [
      'upstream/build-design/figma.md',
      'upstream/explain-interface/read-the-system.md',
      'upstream/explain-interface/find-the-effect.md',
      'upstream/explain-interface/from-an-image.md',
      'upstream/explain-interface/no-browser.md',
      'upstream/break/scenarios.md',
    ],
  },
  'cairn-design-review': {
    pins: [`jakubkrehel/skills@${JAKUB}`],
    licenses: ['upstream/LICENSE'],
    entries: ['upstream/better-interface/README.md', 'upstream/interface-review/README.md'],
    files: [
      'upstream/better-interface/review-format.md',
      'upstream/interface-review/scope-resolution.md',
      'upstream/interface-review/removed-signals.md',
    ],
  },
  'cairn-motion': {
    pins: [`emilkowalski/skills@${EMIL}`],
    licenses: ['references/LICENSE'],
    entries: [
      'references/emil-design-eng/README.md',
      'references/animate/README.md',
      'references/animation-vocabulary/README.md',
      'references/apple-design/README.md',
      'references/gestures/README.md',
      'references/choreograph/README.md',
      'references/animation-performance/README.md',
    ],
    files: [
      'references/animate/RECIPES.md',
      'references/choreograph/RECIPES.md',
      'references/performance-cheatsheet.md',
    ],
  },
  'cairn-polish': {
    pins: [`emilkowalski/skills@${EMIL}`],
    licenses: ['references/LICENSE'],
    entries: ['references/mobile-native/README.md', 'references/ask-sonner/README.md'],
    files: ['references/ask-sonner/API.md', 'references/ui-cheatsheet.md'],
  },
  'options-prototype-cairn': {
    pins: [`jakubkrehel/skills@${JAKUB}`, `emilkowalski/skills@${EMIL}`],
    licenses: ['upstream/LICENSE', 'references/LICENSE'],
    entries: [
      'upstream/state-machine/README.md',
      'upstream/variant/README.md',
      'references/prototype/README.md',
    ],
    files: [
      'upstream/state-machine/switcher.md',
      'upstream/variant/picker.md',
      'references/prototype/PICKER.md',
    ],
  },
  'retro-cairn': {
    pins: [`emilkowalski/skills@${EMIL}`],
    licenses: ['references/LICENSE'],
    entries: ['references/learn-taste/README.md'],
    files: [],
  },
};

describe('vendored reading trees', () => {
  for (const [skill, tree] of Object.entries(TREES)) {
    const dir = join(SKILLS, skill);
    const wrapper = wrapperText(skill);

    describe(skill, () => {
      test('notes the upstream repo and commit for every author it vendors', () => {
        for (const pin of tree.pins) expect(wrapper, pin).toContain(pin);
      });

      test('carries each vendored LICENSE beside its files', () => {
        for (const license of tree.licenses) {
          expect(readFileSync(join(dir, license), 'utf8'), license).toContain('MIT License');
        }
      });

      test('keeps every upstream SKILL.md as README.md, frontmatter intact', () => {
        for (const entry of tree.entries) {
          const path = join(dir, entry);
          expect(existsSync(path), entry).toBe(true);
          const name = entry.split('/').at(-2) ?? '';
          expect(readFileSync(path, 'utf8'), entry).toContain(`name: ${name}`);
        }
        for (const file of tree.files) expect(existsSync(join(dir, file)), file).toBe(true);
      });
    });
  }
});

describe('cairn-design-review', () => {
  const review = wrapperText('cairn-design-review');

  test('stays manually invoked', () => {
    expect(review).toContain('disable-model-invocation: true');
  });

  test('names only rule ids that exist in the DESIGN.md rule index', () => {
    const ids = new Set([...review.matchAll(/\b([PCVTARL]\d+)\b/g)].map((match) => match[1] ?? ''));
    expect(ids.size).toBeGreaterThan(0);
    expect([...ids].filter((id) => !ruleIds.has(id))).toEqual([]);
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
