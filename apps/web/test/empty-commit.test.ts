import { describe, expect, it } from 'vitest';
import { substantiveChangesOf } from '../src/detail/empty-commit.js';

describe('substantiveChangesOf', () => {
  it('查询未完成或失败 = 未知，不把空集当成零改动', () => {
    expect(substantiveChangesOf({ files: [], reported: true }, false)).toBeNull();
    expect(substantiveChangesOf(undefined, true)).toBeNull();
    expect(substantiveChangesOf(null, true)).toBeNull();
  });

  it('响应没有 reported（旧 server / 未上报折叠成 files:[]）= 未知', () => {
    expect(substantiveChangesOf({ files: [] }, true)).toBeNull();
    expect(substantiveChangesOf({ files: [], reported: false }, true)).toBeNull();
  });

  it('已上报且文件集为空 = 没有实质改动（空提交）', () => {
    expect(substantiveChangesOf({ files: [], reported: true }, true)).toBe(false);
  });

  it('已上报且有文件 = 有实质改动', () => {
    expect(substantiveChangesOf({ files: [{ path: 'README.md' }], reported: true }, true)).toBe(
      true,
    );
  });
});
