import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = new URL('../../../', import.meta.url).pathname;
const SKILLS = join(ROOT, '.claude/skills');

const JAKUB = '672ae44ace6aaed65b86cbb1e2fd6fbea0e79578';
const EMIL = '64eb3deb9a5fbfa041faf783e0bc3fd635872e9c';

const designMd = readFileSync(join(ROOT, 'apps/web/DESIGN.md'), 'utf8');
const surfaceFiles = readdirSync(join(ROOT, 'docs/design/surfaces'))
  .filter((name) => name.endsWith('.md'))
  .sort();
const referenceFolders = readdirSync(join(ROOT, 'docs/design/references'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const ruleDocs = [
  designMd,
  ...surfaceFiles.map((name) => readFileSync(join(ROOT, 'docs/design/surfaces', name), 'utf8')),
];
const ruleIds = new Set(
  ruleDocs
    .map((doc) => (doc.split('\n## Rules\n')[1] ?? '').split('\n## ')[0] ?? '')
    .join('\n')
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

function skillText(skill: string): string {
  return readFileSync(join(SKILLS, skill, 'SKILL.md'), 'utf8');
}

const designCairn = skillText('design-cairn');

describe('no second SKILL.md is discoverable under a vendored tree', () => {
  test.each(['design-cairn', 'cairn-design-review', 'options-prototype-cairn', 'retro-cairn'])(
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

describe('retired rule-wrapper skills and obsolete design docs are removed', () => {
  test.each([
    'cairn-a11y',
    'cairn-copy',
    'cairn-motion',
    'cairn-motion-audit',
    'cairn-polish',
    'cairn-type',
  ])('%s skill directory is deleted', (skill) => {
    expect(existsSync(join(SKILLS, skill))).toBe(false);
    expect(designCairn).not.toContain(skill);
  });

  test.each(['docs/design/rule-ab.md', 'docs/spec/base-ui-theme.md'])(
    '%s is deleted',
    (relPath) => {
      expect(existsSync(join(ROOT, relPath))).toBe(false);
    },
  );
});

describe('one-hop entry from apps/web/DESIGN.md', () => {
  const surfaces = section(designMd, '## Surfaces');

  test('links every surface file and every reference screenshot folder in one hop', () => {
    expect(designMd).toContain('/design.html');
    expect(designMd).toContain('scripts/design-rules-for.mjs');
    for (const file of surfaceFiles) {
      expect(surfaces, `DESIGN.md missing docs/design/surfaces/${file}`).toContain(
        `docs/design/surfaces/${file}`,
      );
    }
    for (const folder of referenceFolders) {
      expect(surfaces, `DESIGN.md missing docs/design/references/${folder}/`).toContain(
        `docs/design/references/${folder}/`,
      );
    }
  });

  test('design-cairn routes to the procedure skills only', () => {
    const related = section(designCairn, '## Related procedures');
    expect(related).toContain('options-prototype-cairn');
    expect(related).toContain('cairn-design-review');
    expect(existsSync(join(SKILLS, 'options-prototype-cairn/SKILL.md'))).toBe(true);
    expect(existsSync(join(SKILLS, 'cairn-design-review/SKILL.md'))).toBe(true);
    expect(designCairn).toContain('apps/web/DESIGN.md');
    expect(designCairn).not.toContain('rule-ab.md');
  });

  test('repo entry docs and reference README point to DESIGN.md in one hop', () => {
    const rootAgents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
    const webAgents = readFileSync(join(ROOT, 'apps/web/AGENTS.md'), 'utf8');
    const refReadme = readFileSync(join(ROOT, 'docs/design/references/README.md'), 'utf8');
    expect(rootAgents).toContain('apps/web/DESIGN.md');
    expect(rootAgents).toContain('/design.html');
    expect(webAgents).toContain('apps/web/DESIGN.md');
    expect(webAgents).toContain('scripts/design-rules-for.mjs');
    expect(refReadme).toContain('apps/web/DESIGN.md');
    for (const folder of referenceFolders) {
      expect(refReadme).toContain(`## ${folder}`);
    }
  });

  test('converged rule files register the owner-principle rule ids', () => {
    for (const id of ['P7', 'T8', 'V33', 'C48', 'V4', 'V5', 'V3', 'V8', 'C3', 'V24']) {
      expect(ruleIds.has(id), `${id} missing from rule index`).toBe(true);
    }
  });
});

const TREES: Record<
  string,
  { pins: string[]; licenses: string[]; entries: string[]; files: string[] }
> = {
  'design-cairn': {
    pins: [`jakubkrehel/skills@${JAKUB}`, `emilkowalski/skills@${EMIL}`],
    licenses: ['upstream/LICENSE', 'upstream/break-ui/LICENSE', 'references/LICENSE'],
    entries: [
      'upstream/build-design/README.md',
      'upstream/explain-interface/README.md',
      'upstream/break/README.md',
      'upstream/break-ui/README.md',
      'references/pick-ui-library/README.md',
    ],
    files: [
      'upstream/build-design/figma.md',
      'upstream/explain-interface/read-the-system.md',
      'upstream/explain-interface/find-the-effect.md',
      'upstream/explain-interface/from-an-image.md',
      'upstream/explain-interface/no-browser.md',
      'upstream/break/scenarios.md',
      'upstream/break-ui/CATALOG.md',
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
    const wrapper = skillText(skill);

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
  const review = skillText('cairn-design-review');

  test('stays manually invoked and includes motion audit', () => {
    expect(review).toContain('disable-model-invocation: true');
    expect(review).toContain('Motion audit');
    expect(review).toContain('docs/design/surfaces/motion.md');
  });

  test('names only rule ids that exist in the DESIGN.md rule index', () => {
    const ids = new Set([...review.matchAll(/\b([PCVTARL]\d+)\b/g)].map((match) => match[1] ?? ''));
    expect(ids.size).toBeGreaterThan(0);
    expect([...ids].filter((id) => !ruleIds.has(id))).toEqual([]);
  });
});

describe('design-cairn vendored catalog', () => {
  const dir = join(SKILLS, 'design-cairn');

  test('the extreme-data catalog is vendored verbatim', () => {
    const catalog = readFileSync(join(dir, 'upstream/break-ui/CATALOG.md'), 'utf8');
    expect(catalog).toContain('Worst-Case Catalog');
    expect(catalog).toContain('bartholomew.fitzgerald@northwind-industries-holdings.example.com');
  });
});
