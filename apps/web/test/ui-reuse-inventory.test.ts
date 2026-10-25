import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = resolve(import.meta.dirname, '..');
const DOC = join(WEB, 'COMPONENTS.md');

const NEW_TRACK_DIR = join(WEB, 'src/components/ui');
const OLD_TRACK_DIR = join(WEB, 'src/ui');

function section(md: string, key: string): string[] {
  const re = new RegExp(`<!-- inventory:${key} -->([\\s\\S]*?)<!-- /inventory:${key} -->`);
  const block = md.match(re)?.[1];
  if (block === undefined) return [];
  return block
    .split('\n')
    .map((l) => l.replace(/`/g, '').replace(/#.*$/, '').trim())
    .filter((l) => /^[\w.-]+\.(tsx|css)$/.test(l));
}

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir)
    .filter((f) => ext.test(f))
    .sort();
}

const md = existsSync(DOC) ? readFileSync(DOC, 'utf8') : '';
const listedNew = section(md, 'new-track');
const listedFrozen = section(md, 'old-track-frozen');
const onDiskNew = files(NEW_TRACK_DIR, /\.tsx$/);
const onDiskOld = existsSync(OLD_TRACK_DIR) ? files(OLD_TRACK_DIR, /\.(tsx|css)$/) : [];

describe('component inventory in sync with source (apps/web/COMPONENTS.md)', () => {
  it('the inventory file exists', () => {
    expect(
      existsSync(DOC),
      '缺 apps/web/COMPONENTS.md —— 复用向清单（有哪些件、该复用谁）是 UI 开工前必读，不能被删。',
    ).toBe(true);
  });

  it('every new-track primitive is registered (read the inventory before adding components)', () => {
    const missing = onDiskNew.filter((f) => !listedNew.includes(f));
    expect(
      missing,
      `src/components/ui/ 下这些件没写进 COMPONENTS.md 的 new-track 段:\n  ${missing.join('\n  ')}\n` +
        `登记前先确认: 已有原语里真的没有能用的吗（这是本 gate 的用意）；确认要新增，就在清单里补一行并写清何时该用它。`,
    ).toEqual([]);
  });

  it('every new-track piece in the inventory really exists (no ghost paths)', () => {
    const ghost = listedNew.filter((f) => !onDiskNew.includes(f));
    expect(ghost, `COMPONENTS.md 列了不存在的文件:\n  ${ghost.join('\n  ')}`).toEqual([]);
  });

  it('old track fully retired: src/ui/ must not resurrect (#952 final state, new pieces all land on the new track)', () => {
    expect(
      existsSync(OLD_TRACK_DIR),
      'src/ui/ 已随 #952 整目录删除（chip/input/dialog 消费点清零，spec/22 §5 退役正典表执行完毕）。' +
        '目录不得复活——新件一律落 src/components/ui/（shadcn + Base UI 基）。',
    ).toBe(false);
    const added = onDiskOld.filter((f) => !listedFrozen.includes(f));
    expect(added, `src/ui/ 出现终态名单外的件:\n  ${added.join('\n  ')}`).toEqual([]);
  });
});