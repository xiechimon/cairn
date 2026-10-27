import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../eval/chief-dispatch/build-report-lite.mts',
);

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function writeFlow(
  name: string,
  cases: string[],
  results: Record<string, unknown>[],
  errors: Record<string, unknown>[],
): string {
  const home = mkdtempSync(join(tmpdir(), `cairn-coverage-${name}-`));
  homes.push(home);
  writeFileSync(
    join(home, 'cases.json'),
    `${JSON.stringify({ cases: cases.map((id) => ({ id })) })}\n`,
  );
  const variant = join(home, 'baseline');
  mkdirSync(variant);
  writeFileSync(
    join(variant, 'results.jsonl'),
    `${results.map((row) => JSON.stringify(row)).join('\n')}\n`,
  );
  writeFileSync(
    join(variant, 'errors.jsonl'),
    errors.length ? `${errors.map((row) => JSON.stringify(row)).join('\n')}\n` : '',
  );
  return home;
}

function scored(id: string, rep: number): Record<string, unknown> {
  return { prompt_id: id, rep, status: 'ok', grade: { decision_ok: 1 } };
}

function failed(id: string, rep: number): Record<string, unknown> {
  return { prompt_id: id, rep, failure_class: 'harness_error' };
}

function report(home: string): string {
  const run = spawnSync(process.execPath, [SCRIPT, home], { encoding: 'utf8' });
  expect(run.status, run.stderr).toBe(0);
  return readFileSync(join(home, 'report.html'), 'utf8');
}

function headline(html: string): string {
  const cell = html.match(/<td class="num" data-headline="([^"]*)">/);
  return cell?.[1] ?? '';
}

describe('chief-dispatch report coverage', () => {
  test('withholds the headline when the s family scores 7 of 18', () => {
    const sCases = ['s01', 's02', 's03', 's04', 's05', 's06'];
    const results = [scored('d01', 0), scored('d01', 1), scored('d01', 2)];
    const errors: Record<string, unknown>[] = [];
    const scoredReps: Record<string, number[]> = {
      s02: [2],
      s03: [1, 2],
      s04: [0, 2],
      s05: [2],
      s06: [1],
    };
    for (const id of sCases) {
      for (const rep of [0, 1, 2]) {
        if (scoredReps[id]?.includes(rep)) results.push(scored(id, rep));
        else errors.push(failed(id, rep));
      }
    }
    const html = report(writeFlow('under', ['d01', ...sCases, 'z01'], results, errors));
    expect(html).toContain('d 3/3');
    expect(html).toContain('s 7/18');
    expect(html).toContain('z 0/3');
    expect(html).toContain('headline withheld: s, z');
    expect(headline(html)).toBe('withheld');
    expect(html).not.toContain('data-headline="1.000"');
  });

  test('prints the headline when every family is at or above 80%', () => {
    const cases = ['e01', 'e02', 'e03', 'e04', 'e05'];
    const results = cases.slice(0, 4).map((id) => scored(id, 0));
    const html = report(writeFlow('exact', cases, results, [failed('e05', 0)]));
    expect(html).toContain('e 4/5');
    expect(html).not.toContain('headline withheld');
    expect(headline(html)).toBe('1.000');
  });

  test('shows per-family coverage when the grid is complete', () => {
    const html = report(
      writeFlow('full', ['d01'], [scored('d01', 0), scored('d01', 1), scored('d01', 2)], []),
    );
    expect(html).toContain('d 3/3');
    expect(html).not.toContain('headline withheld');
    expect(headline(html)).toBe('1.000');
  });
});

test('truncated and ungraded rows do not count as scored coverage', () => {
  const ids = ['s01', 's02', 's03', 's04', 's05', 's06'];
  const rows = [
    scored('s01', 0),
    ...ids.slice(1, 4).map((id) => ({ ...scored(id, 0), status: 'truncated' })),
    ...ids.slice(4).map((id) => ({ ...scored(id, 0), grade: {} })),
  ];
  const html = report(writeFlow('unscored', ids, rows, []));
  expect(html).toContain('s 1/6');
  expect(headline(html)).toBe('withheld');
});

test('a zero-pass case with three trials is listed and withheld without a valid oracle', () => {
  const rows = [0, 1, 2].map((rep) => ({ ...scored('d01', rep), grade: { decision_ok: 0 } }));
  const html = report(writeFlow('suspect', ['d01'], rows, []));
  expect(html).toContain('Suspect tasks');
  expect(html).toContain('d01 0/3');
  expect(html).toContain('oracle unverified');
  expect(headline(html)).toBe('withheld');
});

test('a suspect case enters the headline after its actual reference and negative controls pass', () => {
  const rows = [0, 1, 2].map((rep) => ({ ...scored('d01', rep), grade: { decision_ok: 0 } }));
  const home = writeFlow('oracle', ['d01'], rows, []);
  writeFileSync(
    join(home, 'cases.json'),
    JSON.stringify({
      roster: [
        { key: 'docs', displayName: 'Writer', modelId: 'test', description: 'Writes docs' },
        { key: 'web', displayName: 'Builder', modelId: 'test', description: 'Builds web pages' },
      ],
      cases: [
        { id: 'd01', tags: [], prompt: 'Write docs', expect: { kind: 'dispatch', agent: 'docs' } },
      ],
    }),
  );
  const html = report(home);
  expect(html).toContain('d01 0/3');
  expect(html).toContain('oracle verified');
  expect(headline(html)).toBe('0.000');
});

test('rows without repetition identity cannot establish family coverage', () => {
  const row = { prompt_id: 'd01', status: 'ok', grade: { decision_ok: 1 } };
  const html = report(writeFlow('unknown-reps', ['d01'], [row], []));
  expect(html).toContain('d 0/unknown');
  expect(headline(html)).toBe('withheld');
});

test('mixed known and unknown repetition identities cannot publish a headline', () => {
  const valid = [0, 1, 2, 3].map((rep) => ({ ...scored('d01', rep), grade: { decision_ok: 0 } }));
  const unknown = { prompt_id: 'd01', status: 'ok', grade: { decision_ok: 1 } };
  const html = report(writeFlow('mixed-reps', ['d01'], [...valid, unknown], []));
  expect(html).toContain('d 4/unknown');
  expect(headline(html)).toBe('withheld');
});
