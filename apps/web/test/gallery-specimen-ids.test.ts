import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readGalleryParams } from '../src/design/gallery-params.js';

const DESIGN = resolve(import.meta.dirname, '../src/design');
const SNAPSHOTS = resolve(import.meta.dirname, '../e2e/gallery-snapshots.spec.ts-snapshots');
const BASELINE_NAME = /^(.+)-(?:light|dark)-linux\.png$/;
const ID_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface SpecimenTag {
  where: string;
  id: string | null;
}

function openingTagEnd(source: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (quote != null) {
      if (ch === quote) quote = null;
    } else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (depth === 0 && (ch === '"' || ch === "'")) quote = ch;
    else if (depth === 0 && ch === '>') return i;
  }
  return source.length;
}

function specimenTags(file: string, source: string): SpecimenTag[] {
  const tags: SpecimenTag[] = [];
  for (const match of source.matchAll(/<Specimen\b/g)) {
    const start = match.index;
    const tag = source.slice(start, openingTagEnd(source, start));
    const line = source.slice(0, start).split('\n').length;
    tags.push({ where: `${file}:${line}`, id: tag.match(/\sid="([^"]*)"/)?.[1] ?? null });
  }
  return tags;
}

function problems(tags: SpecimenTag[]): string[] {
  const seen = new Map<string, string>();
  const found: string[] = [];
  for (const { where, id } of tags) {
    if (id == null) {
      found.push(`${where} has no literal id="..."`);
      continue;
    }
    if (!ID_SHAPE.test(id)) found.push(`${where} id "${id}" is not lowercase-kebab`);
    const first = seen.get(id);
    if (first != null) found.push(`${where} reuses id "${id}" from ${first}`);
    else seen.set(id, where);
  }
  return found;
}

const galleryTags = readdirSync(DESIGN)
  .filter((f) => f.endsWith('.tsx') && f !== 'specimen.tsx')
  .flatMap((f) => specimenTags(f, readFileSync(join(DESIGN, f), 'utf8')));

describe('gallery specimen ids', () => {
  it('finds the gallery specimens', () => {
    expect(galleryTags.length).toBeGreaterThan(100);
  });

  it('gives every specimen a unique lowercase-kebab id', () => {
    expect(
      problems(galleryTags),
      'Each <Specimen> needs a literal id="..." that no other specimen uses: it names the snapshot baseline and the /design.html?only=<id> address.',
    ).toEqual([]);
  });

  it('reports a specimen without an id', () => {
    const tags = specimenTags('a.tsx', '<Specimen title="A" note={x > 1 ? "b" : "c"}>\n</Specimen>');
    expect(problems(tags)).toEqual(['a.tsx:1 has no literal id="..."']);
  });

  it('reports two specimens sharing an id', () => {
    const tags = specimenTags(
      'a.tsx',
      '<Specimen id="sizes" title="Sizes">x</Specimen>\n<Specimen\n  id="sizes"\n  title="Sizes">y</Specimen>',
    );
    expect(problems(tags)).toEqual(['a.tsx:2 reuses id "sizes" from a.tsx:1']);
  });
});

function orphanBaselines(files: string[], ids: Set<string>): string[] {
  return files.filter((file) => {
    const id = file.match(BASELINE_NAME)?.[1];
    return id == null || !ids.has(id);
  });
}

describe('gallery snapshot baselines', () => {
  it('has no baseline file without a matching specimen id', () => {
    const ids = new Set(galleryTags.flatMap(({ id }) => (id == null ? [] : [id])));
    expect(
      orphanBaselines(readdirSync(SNAPSHOTS), ids),
      'Delete these baselines from gallery-snapshots.spec.ts-snapshots, or restore the specimen id they were rendered from.',
    ).toEqual([]);
  });

  it('reports a baseline whose specimen was removed or renamed', () => {
    const ids = new Set(['pr-card']);
    expect(
      orphanBaselines(['pr-card-light-linux.png', 'pr-card-dark-linux.png', 'gone-light-linux.png', 'notes.txt'], ids),
    ).toEqual(['gone-light-linux.png', 'notes.txt']);
  });
});

describe('readGalleryParams', () => {
  it('reads only, theme and width', () => {
    expect(readGalleryParams('?only=pr-card&theme=light&w=375')).toEqual({
      only: 'pr-card',
      theme: 'light',
      width: 375,
    });
  });

  it('ignores an unknown theme, a bad width and an empty id', () => {
    expect(readGalleryParams('?only=&theme=blue&w=wide')).toEqual({
      only: null,
      theme: null,
      width: null,
    });
    expect(readGalleryParams('?w=-5').width).toBeNull();
  });
});
