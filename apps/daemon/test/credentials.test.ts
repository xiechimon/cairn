// pushCredential 单测（#1484）：步内 git 凭证绑定 claim 的 project.repo.cloneUrl。
//   1. token 响应带 git → 绑定 cloneUrl，用户名 / 密码原样
//   2. token 响应不带 git → null
//   3. 步不绑 repo（cloneUrl 缺席）→ null：没有可绑定的主机，凭证不进任何 git 调用

import { describe, expect, test } from 'vitest';
import { pushCredential } from '../src/credentials.js';

const TOKEN = {
  provider: null,
  secrets: {},
  git: { username: 'x-access-token', password: 'ghs_step' },
};

describe('pushCredential — git 凭证绑定 claim 的 cloneUrl（#1484）', () => {
  test('失败方式 1：绑定 cloneUrl', () => {
    expect(pushCredential(TOKEN, 'https://github.com/o/r.git').git).toEqual({
      username: 'x-access-token',
      password: 'ghs_step',
      url: 'https://github.com/o/r.git',
    });
  });

  test('失败方式 2：token 响应不带 git → null', () => {
    expect(pushCredential({ ...TOKEN, git: null }, 'https://github.com/o/r.git').git).toBeNull();
  });

  test('失败方式 3：步不绑 repo → null', () => {
    expect(pushCredential(TOKEN, null).git).toBeNull();
  });
});
