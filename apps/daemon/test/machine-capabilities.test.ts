// #1251 机器能力探测（machine-capabilities.ts）。失败方式（先于实现固化）：
// 1. 全函数纪律（claude-code-bin.ts「探测不许把 presence 节拍或上线序列搞挂」
//    同律）：MCP config 缺失 / 坏 JSON / 非对象 → mcpServers 空集；skillsDir
//    缺失 / 不可读 → skills 空集；任何输入永不 throw。
// 2. slug 归一：上报值 = parseClaudeMcpEntries 的小写 slug（claim 面匹配键
//    同源）——大小写变体键报同一 slug，撞名 first-wins 后不重复。
// 3. 坏条目不殃及其它：entry 级校验失败的 MCP 条目跳过，其余 slug 照常上报
//    （shared parseClaudeMcpEntries 律，server 投影面同款）。
// 4. skills = 含 SKILL.md 的一级子目录名（盘位事实；frontmatter id 解析归
//    server 投影面，上报面不造第二真值）。无 SKILL.md 的子目录与散文件不算。
// 5. mtime 缓存：内容未变不重读（~/.claude.json 可达数 MB，30s 节拍重解析
//    是纯浪费）；mtime 变化 → 下次调用报新值；stat 失败 → 保守沿用旧值。
// 6. 确定性输出：两集各自排序（wire 断言稳定）。

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { machineHardwareSchema } from '@pacman/shared';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createMachineCapabilitiesProbe,
  probeMachineCapabilities,
  probeMachineHardware,
} from '../src/machine-capabilities.js';

const tmpDirs: string[] = [];
function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pacman-caps-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('probeMachineCapabilities（一次性探测，全函数）', () => {
  test('失败方式 1：两源全缺 → 空集，不 throw', () => {
    const root = tmpRoot();
    const caps = probeMachineCapabilities({
      mcpConfigPath: join(root, 'absent.json'),
      skillsDir: join(root, 'absent-skills'),
    });
    expect(caps).toMatchObject({ mcpServers: [], skills: [] });
  });

  test('失败方式 1：坏 JSON / 非对象 JSON → mcpServers 空集', () => {
    const root = tmpRoot();
    const bad = join(root, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(
      probeMachineCapabilities({ mcpConfigPath: bad, skillsDir: join(root, 'x') }).mcpServers,
    ).toEqual([]);
    const arr = join(root, 'arr.json');
    writeFileSync(arr, '[1,2]');
    expect(
      probeMachineCapabilities({ mcpConfigPath: arr, skillsDir: join(root, 'x') }).mcpServers,
    ).toEqual([]);
  });

  test('失败方式 2+3：slug 小写归一、撞名去重、坏条目跳过', () => {
    const root = tmpRoot();
    const cfg = join(root, 'claude.json');
    writeFileSync(
      cfg,
      JSON.stringify({
        mcpServers: {
          Figma: { type: 'http', url: 'https://mcp.figma.com/mcp' },
          figma: { type: 'http', url: 'https://dup.example/mcp' },
          broken: { type: 'stdio' }, // 缺 command = entry 校验失败 → 跳过
          ctx: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
        },
        projects: { '/some/repo': { history: [] } },
      }),
    );
    const caps = probeMachineCapabilities({ mcpConfigPath: cfg, skillsDir: join(root, 'x') });
    expect(caps.mcpServers).toEqual(['ctx', 'figma']);
  });

  test('失败方式 4：skills = 含 SKILL.md 的一级子目录名', () => {
    const root = tmpRoot();
    const skills = join(root, 'skills');
    mkdirSync(join(skills, 'verify-pacman'), { recursive: true });
    writeFileSync(join(skills, 'verify-pacman', 'SKILL.md'), '# verify');
    mkdirSync(join(skills, 'no-manifest')); // 无 SKILL.md → 不算
    writeFileSync(join(skills, 'loose.md'), 'x'); // 散文件 → 不算
    mkdirSync(join(skills, 'nested', 'deep'), { recursive: true });
    writeFileSync(join(skills, 'nested', 'SKILL.md'), '# nested'); // 一级判定只看直接子目录
    const caps = probeMachineCapabilities({
      mcpConfigPath: join(root, 'absent.json'),
      skillsDir: skills,
    });
    expect(caps.skills).toEqual(['nested', 'verify-pacman']);
  });

  test('失败方式 6：输出排序确定', () => {
    const root = tmpRoot();
    const cfg = join(root, 'claude.json');
    writeFileSync(
      cfg,
      JSON.stringify({
        mcpServers: {
          zeta: { type: 'http', url: 'https://z.example' },
          alpha: { type: 'http', url: 'https://a.example' },
        },
      }),
    );
    const skills = join(root, 'skills');
    mkdirSync(join(skills, 'z-skill'), { recursive: true });
    writeFileSync(join(skills, 'z-skill', 'SKILL.md'), '#');
    mkdirSync(join(skills, 'a-skill'), { recursive: true });
    writeFileSync(join(skills, 'a-skill', 'SKILL.md'), '#');
    const caps = probeMachineCapabilities({ mcpConfigPath: cfg, skillsDir: skills });
    expect(caps.mcpServers).toEqual(['alpha', 'zeta']);
    expect(caps.skills).toEqual(['a-skill', 'z-skill']);
  });
});

describe('createMachineCapabilitiesProbe（mtime 缓存的节拍探测）', () => {
  test('失败方式 5：内容未变不重读、变化即报新值', () => {
    const root = tmpRoot();
    const cfg = join(root, 'claude.json');
    writeFileSync(cfg, JSON.stringify({ mcpServers: { a: { type: 'http', url: 'https://a' } } }));
    const skills = join(root, 'skills');
    mkdirSync(join(skills, 's1'), { recursive: true });
    writeFileSync(join(skills, 's1', 'SKILL.md'), '#');
    const probe = createMachineCapabilitiesProbe({ mcpConfigPath: cfg, skillsDir: skills });
    expect(probe()).toMatchObject({ mcpServers: ['a'], skills: ['s1'] });
    expect(probe()).toMatchObject({ mcpServers: ['a'], skills: ['s1'] }); // 缓存路径同值

    // MCP 配置变化（mtime 前推）→ 新 slug 上行。
    writeFileSync(
      cfg,
      JSON.stringify({
        mcpServers: {
          a: { type: 'http', url: 'https://a' },
          b: { type: 'http', url: 'https://b' },
        },
      }),
    );
    const later = new Date(Date.now() + 60_000);
    utimesSync(cfg, later, later);
    expect(probe().mcpServers).toEqual(['a', 'b']);

    // skills 目录变化（新技能目录）→ 新名上行。
    mkdirSync(join(skills, 's2'), { recursive: true });
    writeFileSync(join(skills, 's2', 'SKILL.md'), '#');
    const later2 = new Date(Date.now() + 120_000);
    utimesSync(skills, later2, later2);
    expect(probe().skills).toEqual(['s1', 's2']);
  });

  test('失败方式 5：源消失后 stat 失败 → 报空集（消失是事实，不是沿用旧值）', () => {
    const root = tmpRoot();
    const cfg = join(root, 'claude.json');
    writeFileSync(cfg, JSON.stringify({ mcpServers: { a: { type: 'http', url: 'https://a' } } }));
    const probe = createMachineCapabilitiesProbe({
      mcpConfigPath: cfg,
      skillsDir: join(root, 'absent'),
    });
    expect(probe().mcpServers).toEqual(['a']);
    rmSync(cfg);
    expect(probe().mcpServers).toEqual([]);
  });
});

// #1241 机器能力指纹（probeMachineHardware）。失败方式（先于实现固化）：
// H1 全函数：磁盘路径不存在 → 回落 `/` 的余量，指纹仍整块上报（不 throw、不缺席）。
// H2 形状：任何一拍的指纹都能过 machineHardwareSchema（server 收严的同一把尺）。
// H3 核数取真值：cpuCores = os.cpus().length（推荐公式的输入不能是常量）。
// H4 能力包并入：createMachineCapabilitiesProbe / probeMachineCapabilities 把
//    指纹随 mcp/skills 同包上报；缺席 hardware 时整包仍合法（老形态零漂移）。
describe('probeMachineHardware（#1241 能力指纹）', () => {
  test('H1 磁盘路径不存在 → 回落 `/` 取余量，指纹整块上报', () => {
    const hw = probeMachineHardware(join(tmpRoot(), 'absent', 'skills'));
    expect(hw).toBeDefined();
    expect(machineHardwareSchema.parse(hw)).toEqual(hw);
    expect(hw!.diskFreeMb).toBeGreaterThanOrEqual(0);
  });

  test('H2 形状：指纹过 machineHardwareSchema（核 ≥ 1，内存/磁盘非负整数）', () => {
    const hw = probeMachineHardware(tmpRoot());
    expect(() => machineHardwareSchema.parse(hw)).not.toThrow();
    expect(Number.isInteger(hw!.memoryAvailableMb)).toBe(true);
    expect(hw!.loadAvg1).toBeGreaterThanOrEqual(0);
  });

  test('H3 核数 = 本机 os.cpus().length', () => {
    expect(probeMachineHardware(tmpRoot())!.cpuCores).toBe(cpus().length);
  });

  test('H3 内存总量 = 本机 os.totalmem()（推荐公式的内存输入，不随运行中的步变化）', () => {
    expect(probeMachineHardware(tmpRoot())!.memoryTotalMb).toBe(
      Math.floor(totalmem() / (1024 * 1024)),
    );
  });

  test('H4 能力包并入指纹；一次性探测与节拍探测同形', () => {
    const root = tmpRoot();
    const once = probeMachineCapabilities({
      mcpConfigPath: join(root, 'absent.json'),
      skillsDir: join(root, 'absent'),
    });
    expect(machineHardwareSchema.parse(once.hardware)).toEqual(once.hardware);
    const beat = createMachineCapabilitiesProbe({
      mcpConfigPath: join(root, 'absent.json'),
      skillsDir: join(root, 'absent'),
    })();
    // 可用内存是现读值，两次探测之间会漂移，只比核数这类稳定字段。
    expect(beat.hardware).toBeDefined();
    expect(beat.hardware?.cpuCores).toBe(once.hardware?.cpuCores);
    expect(beat.mcpServers).toEqual([]);
    expect(beat.skills).toEqual([]);
  });
});
