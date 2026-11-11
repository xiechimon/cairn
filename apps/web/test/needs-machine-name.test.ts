import { describe, expect, test } from 'vitest';
import { needsMachineName } from '../src/chief/needs-machine-name.js';

describe('needsMachineName', () => {
  test('several online machines and no session pin require a name', () => {
    expect(needsMachineName([{ online: true }, { online: true }], null)).toBe(true);
  });

  test('one online machine, an existing pin, or a still-loading list do not block', () => {
    expect(needsMachineName([{ online: true }, { online: false }], null)).toBe(false);
    expect(needsMachineName([{ online: true }, { online: true }], 'mach-a')).toBe(false);
    expect(needsMachineName([{ online: true }, { online: true }], null, 'task-mach')).toBe(false);
    expect(needsMachineName(undefined, null)).toBe(false);
  });
});
