import { readdirSync, readFileSync, statfsSync, statSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import {
  type MachineCapabilities,
  type MachineHardware,
  machineCapabilitiesSchema,
  osPlatformOf,
  parseClaudeMcpEntries,
} from '@cairn/shared';
import { agentReachEnabled } from './web-tools.js';

export interface MachineCapabilitySources {
  mcpConfigPath: string;
  skillsDir: string;
}

function probeOsDistribution(): string | undefined {
  if (process.platform !== 'linux') return undefined;
  for (const path of ['/etc/os-release', '/usr/lib/os-release']) {
    try {
      const id = parseEnv(readFileSync(path, 'utf8')).ID;
      const parsed = machineCapabilitiesSchema.shape.osDistribution.safeParse(id);
      return parsed.success ? parsed.data : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
    }
  }
  return undefined;
}

function scanMcpSlugs(mcpConfigPath: string): string[] {
  try {
    const json: unknown = JSON.parse(readFileSync(mcpConfigPath, 'utf8'));
    return [...new Set(parseClaudeMcpEntries(json).map((e) => e.slug))].sort();
  } catch {
    return [];
  }
}

function scanSkillNames(skillsDir: string): string[] {
  let entryNames: string[];
  try {
    entryNames = readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const name of entryNames) {
    try {
      if (statSync(join(skillsDir, name, 'SKILL.md')).isFile()) names.push(name);
    } catch {}
  }
  return names.sort();
}

function diskFreeMb(path: string): number | undefined {
  const read = (target: string): number | undefined => {
    try {
      const st = statfsSync(target);
      return Math.max(0, Math.floor((st.bavail * st.bsize) / (1024 * 1024)));
    } catch {
      return undefined;
    }
  };
  return read(path) ?? read('/');
}

export function probeMachineHardware(diskPath: string): MachineHardware | undefined {
  try {
    const cpuCores = cpus().length;
    if (!Number.isInteger(cpuCores) || cpuCores < 1) return undefined;
    const free = diskFreeMb(diskPath);
    if (free === undefined) return undefined;
    const load = loadavg()[0];
    if (load === undefined || !Number.isFinite(load) || load < 0) return undefined;
    return {
      cpuCores,
      memoryTotalMb: Math.max(0, Math.floor(totalmem() / (1024 * 1024))),
      memoryAvailableMb: Math.max(0, Math.floor(freemem() / (1024 * 1024))),
      loadAvg1: load,
      diskFreeMb: free,
    };
  } catch {
    return undefined;
  }
}

export function probeMachineCapabilities(sources: MachineCapabilitySources): MachineCapabilities {
  const hardware = probeMachineHardware(sources.skillsDir);
  const osDistribution = probeOsDistribution();
  return {
    osPlatform: osPlatformOf(process.platform),
    ...(osDistribution !== undefined ? { osDistribution } : {}),
    mcpServers: scanMcpSlugs(sources.mcpConfigPath),
    skills: scanSkillNames(sources.skillsDir).filter(
      (name) => name !== 'agent-reach' || agentReachEnabled(),
    ),
    ...(hardware !== undefined ? { hardware } : {}),
  };
}

export function createMachineCapabilitiesProbe(
  sources: MachineCapabilitySources,
): () => MachineCapabilities {
  let mcpCache: { mtimeMs: number; value: string[] } | null = null;
  let skillsCache: { mtimeMs: number; value: string[] } | null = null;

  const mtimeOf = (path: string): number | null => {
    try {
      return statSync(path).mtimeMs;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 0 : null;
    }
  };

  return () => {
    const mcpMtime = mtimeOf(sources.mcpConfigPath);
    if (mcpMtime !== null && (mcpCache === null || mcpCache.mtimeMs !== mcpMtime)) {
      mcpCache = { mtimeMs: mcpMtime, value: scanMcpSlugs(sources.mcpConfigPath) };
    }
    if (mcpCache === null) {
      mcpCache = { mtimeMs: Number.NaN, value: scanMcpSlugs(sources.mcpConfigPath) };
    }
    const skillsMtime = mtimeOf(sources.skillsDir);
    if (skillsMtime !== null && (skillsCache === null || skillsCache.mtimeMs !== skillsMtime)) {
      skillsCache = { mtimeMs: skillsMtime, value: scanSkillNames(sources.skillsDir) };
    }
    if (skillsCache === null) {
      skillsCache = { mtimeMs: Number.NaN, value: scanSkillNames(sources.skillsDir) };
    }
    const hardware = probeMachineHardware(sources.skillsDir);
    const osDistribution = probeOsDistribution();
    return {
      osPlatform: osPlatformOf(process.platform),
      ...(osDistribution !== undefined ? { osDistribution } : {}),
      mcpServers: mcpCache.value,
      skills: skillsCache.value.filter((name) => name !== 'agent-reach' || agentReachEnabled()),
      ...(hardware !== undefined ? { hardware } : {}),
    };
  };
}
