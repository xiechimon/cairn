import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const E2E_DIR = new URL('../e2e/', import.meta.url);
const TRACKED_EVIDENCE_WRITE = /(?:path:|screenshot\(|writeFile(?:Sync)?\()[^\n]*docs\/verify/;

test('e2e specs never write into the committed docs/verify evidence', () => {
  const offenders = readdirSync(E2E_DIR)
    .filter((name) => name.endsWith('.ts'))
    .flatMap((name) =>
      readFileSync(new URL(name, E2E_DIR), 'utf8')
        .split('\n')
        .map((line, i) => ({ name, line: i + 1, text: line }))
        .filter(({ text }) => TRACKED_EVIDENCE_WRITE.test(text)),
    )
    .map(({ name, line }) => `e2e/${name}:${line}`);
  expect(offenders).toEqual([]);
});
