// 模型候选投影 toModelOptions（#358，spec 11 §A10；#770 起 providers 段已除
// ——只剩 model-sources 投影；#1288 翻案——pi/relay 段重新进入候选，跨族
// 按 model id 去重、活性取严）——消费面三处（总管压缩模型选择器 / 创建
// Agent 弹窗 / Agent 详情概览），投影本体与消费面无关，故不叫 chief-*。
// 失败方式枚举先行，本文件是场景固化（仓测试规则 3）：
// F1  sources 空 → 空清单（选择器菜单只剩默认行，不崩）
// F2  providers 记录不再是候选源：投影签名只收 sources——custom provider
//     的 models[] 即使存在也不产行（建/改/删走 providers 管理页，执行面按
//     存值解析，两者都不经本投影）
// F3  claude-code 段（installed 带模型）→ provider='claude-code'（runtime
//     词表值）、providerLabel='Claude Code'（品牌名不译，#356 tab 同律）
// F4  sources 的 pi 段产行（#1288 翻案）：provider='pi'（relay 目录探活结果）
// F5  同 (provider, modelId) 重复（settings.json default 槽 + env 槽同 id）
//     → 去重 first-wins（组件 React key `${provider}/${modelId}` 防撞面）
// F5a 跨封套条目同键 → 去重 first-wins（留首名）
// F5b 跨族同 model id（pi 段 + claude-code 段）→ 按 model id 去重（#1288）
// F6  未安装段（installed:false，models=[]）→ 无行贡献，不崩
// F7  序稳定：runtime 段按封套序
// F8  空 id 行跳过（shared modelSourceModelSchema min(1) 卫生在本层对齐）
// F9  活性取严：同 model id 任一源标 dead → 所有行标 dead（#1288）

import type { ModelSource } from '@pacman/shared';
import { describe, expect, it } from 'vitest';
import { toModelOptions } from '../src/api/mappers.js';

function ccSource(models: ModelSource['models'], installed = true): ModelSource {
  return { runtime: 'claude-code', installed, hostname: 'test-host', models };
}

function piSource(models: ModelSource['models']): ModelSource {
  return { runtime: 'pi', installed: true, hostname: 'test-host', models };
}

describe('toModelOptions（#358 数据源投影，#770 providers 段已除，#1288 pi 段回归）', () => {
  it('F1: sources 空 → 空清单', () => {
    expect(toModelOptions([])).toEqual([]);
  });

  it('F3: claude-code 段 → runtime 词表值作 provider、品牌名作 label', () => {
    const rows = toModelOptions([
      ccSource([{ id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' }]),
    ]);
    expect(rows).toEqual([
      {
        provider: 'claude-code',
        providerLabel: 'Claude Code',
        modelId: 'claude-opus-4-5',
        modelName: 'claude-opus-4-5',
      },
    ]);
  });

  it('F4: sources 的 pi 段产行（#1288 relay 目录进入候选）', () => {
    const rows = toModelOptions([piSource([{ id: 'm-a', name: 'M A' }])]);
    expect(rows).toEqual([
      {
        provider: 'pi',
        providerLabel: 'pi',
        modelId: 'm-a',
        modelName: 'M A',
      },
    ]);
  });

  it('F5: claude-code 多槽同 id → 去重 first-wins', () => {
    const rows = toModelOptions([
      ccSource([
        { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' },
        { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'opus' },
      ]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.modelId).toBe('claude-opus-4-5');
  });

  it('F5a: 跨封套条目同键 → 去重 first-wins（留首名）', () => {
    const rows = toModelOptions([
      ccSource([{ id: 'm-x', name: '首名' }]),
      ccSource([{ id: 'm-x', name: '次名' }]),
    ]);
    expect(rows).toEqual([
      {
        provider: 'claude-code',
        providerLabel: 'Claude Code',
        modelId: 'm-x',
        modelName: '首名',
      },
    ]);
  });

  it('F5b: 跨族同 model id（pi 段 + claude-code 段）→ 按 model id 去重', () => {
    const rows = toModelOptions([
      piSource([{ id: 'm-relay', name: 'relay 名' }]),
      ccSource([{ id: 'm-relay', name: '槽位名' }]),
    ]);
    // pi 段在前（封套序），first-wins 留 relay 名。
    expect(rows.map((r) => r.modelId)).toEqual(['m-relay']);
  });

  it('F6: 未安装段（models=[]）→ 无行贡献，不崩', () => {
    expect(toModelOptions([ccSource([], false)])).toEqual([]);
  });

  it('F7: 序 = runtime 段按封套序', () => {
    const rows = toModelOptions([
      piSource([{ id: 'm-a', name: 'M A' }]),
      ccSource([{ id: 'm-cc', name: 'm-cc' }]),
    ]);
    expect(rows.map((r) => `${r.provider}/${r.modelId}`)).toEqual(['pi/m-a', 'claude-code/m-cc']);
  });

  it('F8: 空 id 行跳过', () => {
    const rows = toModelOptions([
      ccSource([
        { id: '', name: '幽灵行' },
        { id: 'm1', name: 'm1' },
      ]),
    ]);
    expect(rows.map((r) => r.modelId)).toEqual(['m1']);
  });

  it('F9: 活性取严——同 model id 任一源标 dead → 该行标 dead', () => {
    const rows = toModelOptions([
      piSource([{ id: 'm-dead', name: 'm-dead', liveness: 'alive' }]),
      ccSource([{ id: 'm-dead', name: 'm-dead', liveness: 'dead' }]),
      ccSource([{ id: 'm-alive', name: 'm-alive', liveness: 'alive' }]),
      piSource([{ id: 'm-unknown', name: 'm-unknown' }]),
    ]);
    const byId = new Map(rows.map((r) => [r.modelId, r]));
    expect(byId.get('m-dead')?.liveness).toBe('dead');
    expect(byId.get('m-alive')?.liveness).toBe('alive');
    expect(byId.get('m-unknown')?.liveness).toBeUndefined(); // unknown 缺省不写
  });
});
