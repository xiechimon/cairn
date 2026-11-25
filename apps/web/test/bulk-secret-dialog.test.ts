import { describe, expect, test } from 'vitest';
import { parseAssignments } from '../src/resources/bulk-secret-dialog.js';

describe('parseAssignments', () => {
  test('strips leading export keyword before validating variable names', () => {
    const parsed = parseAssignments('export API_KEY=secret-123\n  export NODE_ENV="production"');
    expect(parsed.badLines).toEqual([]);
    expect(parsed.entries).toEqual([
      { name: 'API_KEY', value: 'secret-123' },
      { name: 'NODE_ENV', value: 'production' },
    ]);
  });
});
