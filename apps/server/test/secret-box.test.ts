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
  return join(dir, 'server', 'secretbox.key');
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the keyfile lifecycle (01 §4.2: generated on first boot, reused across restarts)', () => {
  test('first boot generates the keyfile: 32 bytes base64, mode 0600', () => {
    const path = tmpKeyfile();
    createKeyfileSecretBox(path);
    const raw = readFileSync(path, 'utf8').trim();
    expect(Buffer.from(raw, 'base64')).toHaveLength(32);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test('a restart reuses the same key: seal on one instance opens on another', () => {
    const path = tmpKeyfile();
    const first = createKeyfileSecretBox(path);
    const envelope = first.seal('sk-provider-key');
    const second = createKeyfileSecretBox(path);
    expect(second.open(envelope)).toBe('sk-provider-key');
    const raw = readFileSync(path, 'utf8');
    createKeyfileSecretBox(path);
    expect(readFileSync(path, 'utf8')).toBe(raw);
  });

  test('a lost keyfile regenerated = existing ciphertexts are dead (the mechanism behind the 02 §8 recovery story)', () => {
    const path = tmpKeyfile();
    const envelope = createKeyfileSecretBox(path).seal('存量 provider key');
    rmSync(path);
    const reborn = createKeyfileSecretBox(path);
    expect(() => reborn.open(envelope)).toThrow(SecretBoxError);
  });

  test('a bad keyfile (wrong length) -> throws at boot, no silent downgrade', () => {
    const path = tmpKeyfile();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from('too-short').toString('base64'));
    expect(() => createKeyfileSecretBox(path)).toThrow(SecretBoxError);
  });
});

describe('envelope and encryption (AES-256-GCM, 01 §4.2)', () => {
  test('roundtrip: unicode / empty string / long text', () => {
    const box = createEphemeralSecretBox();
    for (const plaintext of ['', '密钥值 🔐 ünïcøde', 'x'.repeat(10_000)]) {
      expect(box.open(box.seal(plaintext))).toBe(plaintext);
    }
  });

  test('the envelope starts with the v1 version header; the same plaintext seals differently twice (random iv)', () => {
    const box = createEphemeralSecretBox();
    const a = box.seal('same');
    const b = box.seal('same');
    expect(a.startsWith(`${SECRET_BOX_ENVELOPE_VERSION}:`)).toBe(true);
    expect(a).not.toBe(b);
    expect(box.open(a)).toBe('same');
    expect(box.open(b)).toBe('same');
  });

  test('the ciphertext contains no plaintext substring (the at-rest semantics itself)', () => {
    const box = createEphemeralSecretBox();
    expect(box.seal('sk-ant-secret-value')).not.toContain('sk-ant-secret-value');
  });

  test('tampering with the ciphertext / authTag -> SecretBoxError (GCM authentication)', () => {
    const box = createEphemeralSecretBox();
    const [, payload = ''] = box.seal('payload').split(':');
    const bytes = Buffer.from(payload, 'base64');
    bytes[bytes.length - 20] = ((bytes[bytes.length - 20] ?? 0) ^ 0xff) as number;
    expect(() => box.open(`v1:${bytes.toString('base64')}`)).toThrow(SecretBoxError);
    bytes[bytes.length - 1] = ((bytes[bytes.length - 1] ?? 0) ^ 0xff) as number;
    expect(() => box.open(`v1:${bytes.toString('base64')}`)).toThrow(SecretBoxError);
  });

  test('a different key -> SecretBoxError (a wrong key does not decrypt)', () => {
    const envelope = createEphemeralSecretBox().seal('secret');
    expect(() => createEphemeralSecretBox().open(envelope)).toThrow(SecretBoxError);
  });

  test('a bad envelope: not base64 / wrong version / truncated -> SecretBoxError', () => {
    const box = createEphemeralSecretBox();
    expect(() => box.open('garbage')).toThrow(SecretBoxError);
    expect(() => box.open(`v2:${box.seal('x').slice(3)}`)).toThrow(SecretBoxError);
    expect(() => box.open('v1:AAAA')).toThrow(SecretBoxError);
  });
});
