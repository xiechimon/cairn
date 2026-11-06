import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { JOURNAL, journalNewlineError } from './journal-newline-gate.mjs';

const root = resolve(import.meta.dirname, '..');

test('a journal without a trailing newline is refused with a fix', () => {
  assert.match(journalNewlineError('{"entries":[]}'), /no trailing newline.*printf/);
});

test('a journal with a trailing newline passes', () => {
  assert.equal(journalNewlineError('{"entries":[]}\n'), null);
});

test('the committed journal passes', () => {
  assert.equal(journalNewlineError(readFileSync(resolve(root, JOURNAL), 'utf8')), null);
});
