// 测试用：摘掉进程继承的 GIT_CONFIG_*（云端容器自带三条代理配置），断言的是
// daemon 自己注入什么（#1458 / #1460）。用完 vi.unstubAllEnvs() 恢复。

import { vi } from 'vitest';

export function stubOutInheritedGitConfig(): void {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('GIT_CONFIG_')) vi.stubEnv(k, undefined);
  }
}
