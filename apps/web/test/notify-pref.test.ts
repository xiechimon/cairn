// #1031 通知偏好覆盖（notify-pref）纯函数面。开关「关」要成为能落地的动作，
// 依赖这份读/写契约；sse.ts fireDesktopNotification 的抑制闸读的就是它。
//
// 失败方式枚举（先列后钉）：
//  1. 未设置被误读成某一档——初始面必须回 null（跟随浏览器权限），
//     读成 'off' 会把 granted 用户的开关初始面错关，读成 'on' 反之
//  2. 垃圾值/异型值被误读——旧版本或其它键写坏时须回落 null
//  3. 写读形不对称——persist 后 read 拿不回同一档（开关刷新即丢）

import { describe, expect, it } from 'vitest';
import { readNotifyPref, persistNotifyPref } from '../src/board/notify-pref.js';

function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    dump: () => Object.fromEntries(map),
  };
}

describe('readNotifyPref', () => {
  it('未设置 → null（初始面跟随权限，不预选档）', () => {
    expect(readNotifyPref(memStorage())).toBeNull();
  });

  it('垃圾值 → null（异型存储不炸不误导）', () => {
    for (const junk of ['maybe', '', '2', 'ON', 'true']) {
      expect(readNotifyPref(memStorage({ 'cairn.notifyEnabled': junk })), junk).toBeNull();
    }
  });
});

describe('persistNotifyPref × readNotifyPref 往返', () => {
  it('两档各自写读对称', () => {
    const storage = memStorage();
    persistNotifyPref('off', storage);
    expect(readNotifyPref(storage)).toBe('off');
    persistNotifyPref('on', storage);
    expect(readNotifyPref(storage)).toBe('on');
  });

  it('写面只占一个品牌键（cairn.* 槽，locale 同族）', () => {
    const storage = memStorage();
    persistNotifyPref('off', storage);
    expect(Object.keys(storage.dump())).toEqual(['cairn.notifyEnabled']);
  });
});
