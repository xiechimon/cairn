import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// i18n coverage gate for the desktop shell: the strings a notification or a
// dialog shows come from the web payload (`desktop-notify`) or the zh/en copy
// table, never a literal at the call site — that is how 'Cairn rolled back an
// update' reached a Chinese UI. Menu labels and the 'Cairn' brand string sit
// outside this gate.
const SRC = new URL('../src/', import.meta.url).pathname;
const COPY_TABLE = new Set(['update-copy.ts']);
const KEYS = /^\s*(?:title|message|detail|body|buttons)\s*:\s*['"`]/;
const POSITIONAL = /\b(?:dialog\.)?show(?:MessageBox|ErrorBox)\(\s*['"`]/;
const ALLOW = /title:\s*'Cairn'/;

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (entry.name.endsWith('.ts')) yield full;
  }
}

test('no notification or dialog string is a call-site literal', () => {
  const flagged = [];
  for (const file of files(SRC)) {
    if (COPY_TABLE.has(file.split('/').pop() ?? '')) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (ALLOW.test(line)) return;
        if (KEYS.test(line) || POSITIONAL.test(line))
          flagged.push(`${file.split('/src/').pop()}:${index + 1} ${line.trim()}`);
      });
  }
  assert.deepEqual(flagged, []);
});
