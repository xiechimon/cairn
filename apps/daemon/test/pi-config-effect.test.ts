// provider 配置即时生效（#708 失败方式 3，物化面）：PATCH provider 后新会话
// 按新配置发请求，不依赖 daemon 重启。链路事实（2026-10-03 侦察）：
//   - token/{stepId} 每步现读 server 库；materializeProvider 每次会话创建重写
//     models.json；ModelRuntime.create 每会话重建（磁盘重读）——pi 侧无跨会话
//     缓存。真正的残留staleness = pi.ts 的 learnedCompat 模块级补位：server 侧
//     **删除** compat 旋钮后，学习位会把旧形填回去（重启 daemon 才清）。
// 失败方式枚举先于实现固化：
//   1. 删除位回流：学习翻过 {mct, store} 后 server compat 改为不含它们 → 物化
//      仍带旧学习位（现行为）→ 修后：学习作废，物化 = 纯显式位。
//   2. 学习补位保留：server compat 未变（重复物化同配置）→ 学习照旧补位
//      （#654「学费一次」语义零回归）。
//   3. 变更后再撞错 → 可重新学习（作废不是永久拉黑）。
//   4. 修改位：server compat 显式改写某旋钮 → 物化取新显式值，不被学习位盖。

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderCompat, ProviderConfig } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { adaptProviderCompat, materializeProvider } from '../src/backend/pi.js';

const RELAY_400 = '400: {"message":"Model does not support this protocol.","type":"server_error"}';

function gateway(providerId: string, compat?: ProviderConfig['compat']): ProviderConfig {
  return {
    kind: 'http',
    providerId,
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
    ...(compat !== undefined ? { compat } : {}),
  };
}

function loadCompat(path: string, providerId: string): ProviderCompat | undefined {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    providers: Record<string, { compat?: ProviderCompat }>;
  };
  return raw.providers[providerId]?.compat;
}

describe('materializeProvider 配置变更即时生效（#708 失败方式 3）', () => {
  // 学习面是模块级 Map：每个用例独立 providerId 隔离（pi-protocol-fallback 同律）。

  test('失败方式 1：server compat 删除学习位所填的旋钮 → 学习作废，旧形不回流', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-cfg-'));
    const path = join(dir, 'models.json');
    // 学费：撞错 → learnedCompat 填 {mct:max_tokens, store:false}。
    adaptProviderCompat(gateway('cfg-remove'), RELAY_400);
    materializeProvider(path, gateway('cfg-remove'));
    expect(loadCompat(path, 'cfg-remove')).toEqual({
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
    // server 侧改为显式只钉 supportsDeveloperRole（mct/store 位被删除）→
    // 物化不得再带学习旧形。
    materializeProvider(path, gateway('cfg-remove', { supportsDeveloperRole: false }));
    expect(loadCompat(path, 'cfg-remove')).toEqual({ supportsDeveloperRole: false });
  });

  test('失败方式 2：server compat 未变 → 学习照旧补位（学费一次，零回归）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-cfg-'));
    const path = join(dir, 'models.json');
    adaptProviderCompat(gateway('cfg-stable'), RELAY_400);
    materializeProvider(path, gateway('cfg-stable'));
    materializeProvider(path, gateway('cfg-stable')); // 同配置二次物化（后续步）
    expect(loadCompat(path, 'cfg-stable')).toEqual({
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
  });

  test('失败方式 3：作废后再撞错 → 可重新学习（作废不是永久拉黑）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-cfg-'));
    const path = join(dir, 'models.json');
    // 学费期：server compat 为空，学习 {mct, store}；本次物化兼作基线快照。
    adaptProviderCompat(gateway('cfg-relearn'), RELAY_400);
    materializeProvider(path, gateway('cfg-relearn'));
    expect(loadCompat(path, 'cfg-relearn')).toEqual({
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
    // 变更 → 作废。
    materializeProvider(path, gateway('cfg-relearn', { supportsDeveloperRole: false }));
    expect(loadCompat(path, 'cfg-relearn')).toEqual({ supportsDeveloperRole: false });
    // 新配置下再撞错 → 重新学习并入（新学习位基于新配置，不与显式位冲突）。
    const amended = adaptProviderCompat(
      gateway('cfg-relearn', { supportsDeveloperRole: false }),
      RELAY_400,
    );
    expect(amended?.compat).toEqual({
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
    materializeProvider(path, gateway('cfg-relearn', { supportsDeveloperRole: false }));
    expect(loadCompat(path, 'cfg-relearn')).toEqual({
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      supportsStore: false,
    });
  });

  test('失败方式 4：server compat 显式改写旋钮值 → 物化取新显式值', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-cfg-'));
    const path = join(dir, 'models.json');
    adaptProviderCompat(gateway('cfg-rewrite'), RELAY_400); // 学习 {mct: max_tokens}
    materializeProvider(path, gateway('cfg-rewrite'));
    // server 显式改钉 mct 回现代字段 → 物化取显式值（显式压学习的既有语义
    // 不变；但同 provider 后续无 server 变更时不得把学习位偷偷并回来）。
    materializeProvider(path, gateway('cfg-rewrite', { maxTokensField: 'max_completion_tokens' }));
    expect(loadCompat(path, 'cfg-rewrite')?.maxTokensField).toBe('max_completion_tokens');
  });
});

// —— #927 成本声明位：custom 端点的模型价格（USD / 1M tokens，pi 目录价
// 语义）由 server 配置下发、物化进 models.json 条目——pi calculateCost 据此
// 算 per-message cost（宿主不自造价格表、不重算）。无价格声明维持零价
// （cost 恒 0 = 如实反映「该端点无价格来源」）。
describe('materializeProvider cost 声明位（#927）', () => {
  function providerWith(providerId: string, models: ProviderConfig['models']): ProviderConfig {
    return { ...gateway(providerId), models };
  }
  function loadModels(path: string, providerId: string): Record<string, unknown>[] {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      providers: Record<string, { models?: Record<string, unknown>[] }>;
    };
    return raw.providers[providerId]?.models ?? [];
  }

  test('模型声明 cost → models.json 条目 = 声明价（覆盖零默认）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-cost-'));
    const path = join(dir, 'models.json');
    materializeProvider(
      path,
      providerWith('cost-gw', [
        { id: 'm1', name: 'M1', cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
      ]),
    );
    expect(loadModels(path, 'cost-gw')[0]).toMatchObject({
      id: 'm1',
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    });
  });

  test('未声明价格 → 零价默认同形（既有物化产物零回归）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-cost-'));
    const path = join(dir, 'models.json');
    materializeProvider(path, providerWith('cost-none', [{ id: 'm2', name: 'M2' }]));
    expect(loadModels(path, 'cost-none')[0]).toMatchObject({
      id: 'm2',
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });
});

describe('materializeProvider 上下文/输出上限声明位（#1526）', () => {
  function providerWith(providerId: string, models: ProviderConfig['models']): ProviderConfig {
    return { ...gateway(providerId), models };
  }
  function loadModels(path: string, providerId: string): Record<string, unknown>[] {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      providers: Record<string, { models?: Record<string, unknown>[] }>;
    };
    return raw.providers[providerId]?.models ?? [];
  }

  test('模型声明 contextWindow=1000000 → models.json 条目 = 声明值（1M 上下文不再被 128k 默认截短）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-ctxwin-'));
    const path = join(dir, 'models.json');
    materializeProvider(
      path,
      providerWith('ctx-gw', [
        { id: 'glm-5.3', name: 'glm-5.3', contextWindow: 1_000_000, maxTokens: 32_768 },
      ]),
    );
    expect(loadModels(path, 'ctx-gw')[0]).toMatchObject({
      id: 'glm-5.3',
      contextWindow: 1_000_000,
      maxTokens: 32_768,
    });
  });

  test('未声明 → 128k/16k 默认同形（不配时行为不变）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-ctxwin-'));
    const path = join(dir, 'models.json');
    materializeProvider(path, providerWith('ctx-none', [{ id: 'm2', name: 'M2' }]));
    expect(loadModels(path, 'ctx-none')[0]).toMatchObject({
      id: 'm2',
      contextWindow: 128_000,
      maxTokens: 16_384,
    });
  });

  test('同 provider 两模型仅其一声明 → 覆盖按模型独立，不串扰', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-ctxwin-'));
    const path = join(dir, 'models.json');
    materializeProvider(
      path,
      providerWith('ctx-mixed', [
        { id: 'big', name: 'Big', contextWindow: 1_000_000 },
        { id: 'small', name: 'Small' },
      ]),
    );
    const models = loadModels(path, 'ctx-mixed');
    expect(models[0]).toMatchObject({ id: 'big', contextWindow: 1_000_000, maxTokens: 16_384 });
    expect(models[1]).toMatchObject({ id: 'small', contextWindow: 128_000, maxTokens: 16_384 });
  });
});
