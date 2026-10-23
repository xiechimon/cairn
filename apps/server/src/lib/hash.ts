// 凭证哈希（02 §8 API 面：apiKey/machine token 服务端存哈希不存可逆值
// [设计]——登录校验只需匹配，用户视角同为掩码）。
// 算法 = SHA-256 [设计]：对象为高熵随机凭证（cairn_<48hex> = 192bit、机器
// token = 64hex = 256bit），无字典攻击面，不需慢 KDF；不入 SecretBox
// （哈希不可逆，无「解密下发」需求）。

import { createHash } from 'node:crypto';

export function hashCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
