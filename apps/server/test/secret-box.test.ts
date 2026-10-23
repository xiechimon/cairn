// SecretBox 实现对拍（01 §4.2 锁定细案 + 02 §8 at-rest 层）：
// - keyfile：首次启动生成 = crypto.randomBytes(32) base64、权限 0600；重启复用
// - 信封：`v1` 版本头 + iv + ciphertext + authTag（AES-256-GCM）
// - 护栏：篡改 / 换 key / 坏信封 / 坏 keyfile → 抛 SecretBoxError（GCM 认证）；
//   keyfile 丢失再生成 = 存量密文报废口径（README 护栏的机制面实证）。

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SECRET_BOX_ENVELOPE_VERSION } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createEphemeralSecretBox,
  createKeyfileSecretBox,
  SecretBoxError,
} from '../src/lib/secret-box.js';

const tmpDirs: string[] = [];
function tmpKeyfile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-secretbox-'));
  tmpDirs.push(dir);
  return join(dir, 'server', 'secretbox.key'); // 嵌套目录顺带验证 mkdir -p
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('keyfile 生命周期（01 §4.2：首启生成、重启复用）', () => {
  test('首次启动生成 keyfile：32 字节 base64、权限 0600', () => {
    const path = tmpKeyfile();
    createKeyfileSecretBox(path);
    const raw = readFileSync(path, 'utf8').trim();
    expect(Buffer.from(raw, 'base64')).toHaveLength(32);
    // 权限位低 9 位 = 0600（root 位/SUID 位不计）。
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test('重启复用同一 key：跨实例 seal/open 互通', () => {
    const path = tmpKeyfile();
    const first = createKeyfileSecretBox(path);
    const envelope = first.seal('sk-provider-key');
    const second = createKeyfileSecretBox(path);
    expect(second.open(envelope)).toBe('sk-provider-key');
    // 复用 = 不重写文件（内容逐字节稳定）。
    const raw = readFileSync(path, 'utf8');
    createKeyfileSecretBox(path);
    expect(readFileSync(path, 'utf8')).toBe(raw);
  });

  test('keyfile 丢失再生成 = 存量密文报废（02 §8 恢复口径的机制面）', () => {
    const path = tmpKeyfile();
    const envelope = createKeyfileSecretBox(path).seal('存量 provider key');
    rmSync(path); // 丢失
    const reborn = createKeyfileSecretBox(path); // 首启语义再生成
    expect(() => reborn.open(envelope)).toThrow(SecretBoxError);
  });

  test('坏 keyfile（长度不符）→ 启动即抛，不静默降级', () => {
    const path = tmpKeyfile();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from('too-short').toString('base64'));
    expect(() => createKeyfileSecretBox(path)).toThrow(SecretBoxError);
  });
});

describe('信封与加解密（AES-256-GCM，01 §4.2）', () => {
  test('roundtrip：unicode / 空串 / 长文本', () => {
    const box = createEphemeralSecretBox();
    for (const plaintext of ['', '密钥值 🔐 ünïcøde', 'x'.repeat(10_000)]) {
      expect(box.open(box.seal(plaintext))).toBe(plaintext);
    }
  });

  test('信封 = v1 版本头起首；同明文两次 seal 密文不同（iv 随机）', () => {
    const box = createEphemeralSecretBox();
    const a = box.seal('same');
    const b = box.seal('same');
    expect(a.startsWith(`${SECRET_BOX_ENVELOPE_VERSION}:`)).toBe(true);
    expect(a).not.toBe(b);
    expect(box.open(a)).toBe('same');
    expect(box.open(b)).toBe('same');
  });

  test('密文不含明文子串（at-rest 语义本体）', () => {
    const box = createEphemeralSecretBox();
    expect(box.seal('sk-ant-secret-value')).not.toContain('sk-ant-secret-value');
  });

  test('篡改密文 / 篡改 authTag → SecretBoxError（GCM 认证）', () => {
    const box = createEphemeralSecretBox();
    const [, payload = ''] = box.seal('payload').split(':');
    const bytes = Buffer.from(payload, 'base64');
    bytes[bytes.length - 20] = ((bytes[bytes.length - 20] ?? 0) ^ 0xff) as number; // ct 区翻转
    expect(() => box.open(`v1:${bytes.toString('base64')}`)).toThrow(SecretBoxError);
    bytes[bytes.length - 1] = ((bytes[bytes.length - 1] ?? 0) ^ 0xff) as number; // tag 末位翻转
    expect(() => box.open(`v1:${bytes.toString('base64')}`)).toThrow(SecretBoxError);
  });

  test('换 key → SecretBoxError（错 key 不可解）', () => {
    const envelope = createEphemeralSecretBox().seal('secret');
    expect(() => createEphemeralSecretBox().open(envelope)).toThrow(SecretBoxError);
  });

  test('坏信封：非 base64 / 版本不符 / 截断 → SecretBoxError', () => {
    const box = createEphemeralSecretBox();
    expect(() => box.open('garbage')).toThrow(SecretBoxError);
    expect(() => box.open(`v2:${box.seal('x').slice(3)}`)).toThrow(SecretBoxError);
    expect(() => box.open('v1:AAAA')).toThrow(SecretBoxError); // 短于 iv+tag
  });
});
