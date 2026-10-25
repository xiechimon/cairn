import { describe, expect, test } from 'vitest';
import { pushCredential } from '../src/credentials.js';

const TOKEN = {
  provider: null,
  secrets: {},
  git: { username: 'x-access-token', password: 'ghs_step' },
};

describe("pushCredential — git credential bound to the claim's cloneUrl (#1484)", () => {
  test('failure mode 1: binds cloneUrl', () => {
    expect(pushCredential(TOKEN, 'https://github.com/o/r.git').git).toEqual({
      username: 'x-access-token',
      password: 'ghs_step',
      url: 'https://github.com/o/r.git',
    });
  });

  test('failure mode 2: token response without git → null', () => {
    expect(pushCredential({ ...TOKEN, git: null }, 'https://github.com/o/r.git').git).toBeNull();
  });

  test('failure mode 3: step not bound to a repo → null', () => {
    expect(pushCredential(TOKEN, null).git).toBeNull();
  });
});
