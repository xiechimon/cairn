import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { machineHardwareSchema } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createMachineCapabilitiesProbe,
  probeMachineCapabilities,
  probeMachineHardware,
} from '../src/machine-capabilities.js';

const tmpDirs: string[] = [];
function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-caps-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('probeMachineCapabilities (one-shot probe, whole function)', () => {
  test('failure mode 1: both sources missing → empty set, no throw', () => {
    const root = tmpRoot();
    const caps = probeMachineCapabilities({
      mcpConfigPath: join(root, 'absent.json'),
      skillsDir: join(root, 'absent-skills'),
    });
    expect(caps).toMatchObject({ mcpServers: [], skills: [] });
  });

  test('failure mode 1: bad JSON / non-object JSON → empty mcpServers set', () => {
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

  test('failure modes 2+3: slug lowercased, collisions deduped, bad entries skipped', () => {
    const root = tmpRoot();
    const cfg = join(root, 'claude.json');
    writeFileSync(
      cfg,
      JSON.stringify({
        mcpServers: {
          Figma: { type: 'http', url: 'https://mcp.figma.com/mcp' },
          figma: { type: 'http', url: 'https://dup.example/mcp' },
          broken: { type: 'stdio' },
          ctx: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
        },
        projects: { '/some/repo': { history: [] } },
      }),
    );
    const caps = probeMachineCapabilities({ mcpConfigPath: cfg, skillsDir: join(root, 'x') });
    expect(caps.mcpServers).toEqual(['ctx', 'figma']);
  });

  test('failure mode 4: skills = first-level subdirectory names containing SKILL.md', () => {
    const root = tmpRoot();
    const skills = join(root, 'skills');
    mkdirSync(join(skills, 'verify-cairn'), { recursive: true });
    writeFileSync(join(skills, 'verify-cairn', 'SKILL.md'), '# verify');
    mkdirSync(join(skills, 'no-manifest'));
    writeFileSync(join(skills, 'loose.md'), 'x');
    mkdirSync(join(skills, 'nested', 'deep'), { recursive: true });
    writeFileSync(join(skills, 'nested', 'SKILL.md'), '# nested');
    const caps = probeMachineCapabilities({
      mcpConfigPath: join(root, 'absent.json'),
      skillsDir: skills,
    });
    expect(caps.skills).toEqual(['nested', 'verify-cairn']);
  });

  test('failure mode 6: output ordering deterministic', () => {
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

describe('createMachineCapabilitiesProbe (beat probe with mtime caching)', () => {
  test('failure mode 5: unchanged content is not re-read, changes report the new value', () => {
    const root = tmpRoot();
    const cfg = join(root, 'claude.json');
    writeFileSync(cfg, JSON.stringify({ mcpServers: { a: { type: 'http', url: 'https://a' } } }));
    const skills = join(root, 'skills');
    mkdirSync(join(skills, 's1'), { recursive: true });
    writeFileSync(join(skills, 's1', 'SKILL.md'), '#');
    const probe = createMachineCapabilitiesProbe({ mcpConfigPath: cfg, skillsDir: skills });
    expect(probe()).toMatchObject({ mcpServers: ['a'], skills: ['s1'] });
    expect(probe()).toMatchObject({ mcpServers: ['a'], skills: ['s1'] });

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

    mkdirSync(join(skills, 's2'), { recursive: true });
    writeFileSync(join(skills, 's2', 'SKILL.md'), '#');
    const later2 = new Date(Date.now() + 120_000);
    utimesSync(skills, later2, later2);
    expect(probe().skills).toEqual(['s1', 's2']);
  });

  test('failure mode 5: stat fails after the source disappears → reports the empty set (disappearance is a fact, not a reason to keep the old value)', () => {
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

describe('probeMachineHardware (#1241 capability fingerprint)', () => {
  test('H1 disk path missing → falls back to `/` for headroom, fingerprint reported whole', () => {
    const hw = probeMachineHardware(join(tmpRoot(), 'absent', 'skills'));
    expect(hw).toBeDefined();
    expect(machineHardwareSchema.parse(hw)).toEqual(hw);
    expect(hw!.diskFreeMb).toBeGreaterThanOrEqual(0);
  });

  test('H2 shape: fingerprint passes machineHardwareSchema (cores ≥ 1, memory/disk non-negative integers)', () => {
    const hw = probeMachineHardware(tmpRoot());
    expect(() => machineHardwareSchema.parse(hw)).not.toThrow();
    expect(Number.isInteger(hw!.memoryAvailableMb)).toBe(true);
    expect(hw!.loadAvg1).toBeGreaterThanOrEqual(0);
  });

  test('H3 core count = local os.cpus().length', () => {
    expect(probeMachineHardware(tmpRoot())!.cpuCores).toBe(cpus().length);
  });

  test('H3 total memory = local os.totalmem() (memory input of the recommendation formula, does not vary with running steps)', () => {
    expect(probeMachineHardware(tmpRoot())!.memoryTotalMb).toBe(
      Math.floor(totalmem() / (1024 * 1024)),
    );
  });

  test('H4 capability package merged into the fingerprint; one-shot probe and beat probe share the shape', () => {
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
    expect(beat.hardware).toBeDefined();
    expect(beat.hardware?.cpuCores).toBe(once.hardware?.cpuCores);
    expect(beat.mcpServers).toEqual([]);
    expect(beat.skills).toEqual([]);
  });
});
