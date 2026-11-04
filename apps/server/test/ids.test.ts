import { expect, test } from 'vitest';
import { newRecordId } from '../src/lib/ids.js';

test('record ids never start with a dash so they stay usable as CLI option values', () => {
  for (let i = 0; i < 5000; i++) {
    expect(newRecordId()).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{20}$/);
  }
});
