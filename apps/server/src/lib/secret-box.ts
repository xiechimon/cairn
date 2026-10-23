// SecretBox 缝的 server 实现（接口 = shared secret-box.ts，01 §4.4 缝纪律）：
// node:crypto AES-256-GCM；keyfile = crypto.randomBytes(32) base64、权限 0600、
// 首次启动生成（01 §4.2 锁定行原样）。信封串 = `v1:` + base64(iv ‖ ciphertext
// ‖ authTag)（版本头 + 三段次序 = 01 §4.2；分隔符与 base64 编码 [设计]）。
// 护栏：keyfile 丢失再生成 = 存量密文永久不可解（报废需重录，02 §8——
// apps/server/README.md 落文档）；一切解密失败统一 SecretBoxError。

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SECRET_BOX_ENVELOPE_VERSION, type SecretBox } from '@cairn/shared';

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM 推荐 iv 长
const TAG_BYTES = 16; // GCM authTag 长

export class SecretBoxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SecretBoxError';
  }
}

function codec(key: Buffer): SecretBox {
  return {
    seal(plaintext: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const body = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
      return `${SECRET_BOX_ENVELOPE_VERSION}:${body.toString('base64')}`;
    },
    open(envelope: string): string {
      const sep = envelope.indexOf(':');
      const version = sep >= 0 ? envelope.slice(0, sep) : '';
      if (version !== SECRET_BOX_ENVELOPE_VERSION) {
        throw new SecretBoxError(`unknown envelope version: ${version || '(missing)'}`);
      }
      const body = Buffer.from(envelope.slice(sep + 1), 'base64');
      if (body.length < IV_BYTES + TAG_BYTES) {
        throw new SecretBoxError('malformed envelope: truncated body');
      }
      const iv = body.subarray(0, IV_BYTES);
      const authTag = body.subarray(body.length - TAG_BYTES);
      const ciphertext = body.subarray(IV_BYTES, body.length - TAG_BYTES);
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch (err) {
        // GCM 认证失败 = 密文被篡改或 keyfile 不匹配（丢失后再生成即此路径）。
        throw new SecretBoxError('envelope authentication failed (tampered or wrong keyfile)', {
          cause: err,
        });
      }
    },
  };
}

/** 生产面：keyfile 落数据根（01 §4.2 单一数据根；文件名 secretbox.key
 * [设计]，品牌槽归 #44）。首启生成（0600），此后只读复用。 */
export function createKeyfileSecretBox(keyfilePath: string): SecretBox {
  mkdirSync(dirname(keyfilePath), { recursive: true });
  if (!existsSync(keyfilePath)) {
    writeFileSync(keyfilePath, `${randomBytes(KEY_BYTES).toString('base64')}\n`, {
      mode: 0o600,
    });
    chmodSync(keyfilePath, 0o600); // mode 受 umask 削减，显式钉死 0600
  }
  const key = Buffer.from(readFileSync(keyfilePath, 'utf8').trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError(
      `keyfile malformed (expected base64 of ${KEY_BYTES} bytes): ${keyfilePath}`,
    );
  }
  return codec(key);
}

/** 测试面：随机 key 驻内存，不触盘（同一 codec，信封形状一致）。 */
export function createEphemeralSecretBox(): SecretBox {
  return codec(randomBytes(KEY_BYTES));
}
