import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statfsSync, statSync } from 'node:fs';
import { type CpuInfo, cpus, freemem, hostname, loadavg, totalmem } from 'node:os';
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

export function probeDeviceName(
  platform: NodeJS.Platform = process.platform,
  readComputerName: () => string = () =>
    execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2_000 }),
): Pick<MachineCapabilities, 'computerName' | 'hostname'> {
  const reportedHostname = machineCapabilitiesSchema.shape.hostname.safeParse(hostname());
  const host = reportedHostname.success ? reportedHostname.data : undefined;
  let computerName: string | undefined;
  if (platform === 'darwin') {
    try {
      const parsed = machineCapabilitiesSchema.shape.computerName.safeParse(readComputerName());
      computerName = parsed.success ? parsed.data : undefined;
    } catch {
      computerName = undefined;
    }
  }
  return {
    ...(computerName !== undefined ? { computerName } : {}),
    ...(host !== undefined ? { hostname: host } : {}),
  };
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

function kernelMemoryLevel(readMemoryLevel: () => string): number | null {
  try {
    const level = Number(readMemoryLevel().trim());
    return Number.isInteger(level) && level >= 0 && level <= 100 ? level : null;
  } catch {
    return null;
  }
}

interface MemoryFigures {
  memoryAvailableMb: number;
  memoryPressure?: number;
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function memoryFigures(
  totalMb: number,
  platform: NodeJS.Platform,
  readMemoryLevel: () => string,
): MemoryFigures {
  const freeMb = Math.max(0, Math.floor(freemem() / (1024 * 1024)));
  if (platform === 'darwin') {
    const level = kernelMemoryLevel(readMemoryLevel);
    if (level === null) return { memoryAvailableMb: freeMb };
    return {
      memoryAvailableMb: Math.floor((totalMb * level) / 100),
      memoryPressure: clampRatio((100 - level) / 100),
    };
  }
  if (totalMb <= 0) return { memoryAvailableMb: freeMb };
  return { memoryAvailableMb: freeMb, memoryPressure: clampRatio(1 - freeMb / totalMb) };
}

const CPU_WINDOW_MIN_MS = 1_000;

export interface CpuWindow {
  total: number;
  idle: number;
}

export function cpuWindowOf(readCpus: () => CpuInfo[] = cpus): CpuWindow {
  let total = 0;
  let idle = 0;
  for (const cpu of readCpus()) {
    const { user, nice, sys, idle: coreIdle, irq } = cpu.times;
    total += user + nice + sys + coreIdle + irq;
    idle += coreIdle;
  }
  return { total, idle };
}

export function cpuUtilizationBetween(prev: CpuWindow, next: CpuWindow): number | undefined {
  const total = next.total - prev.total;
  if (total <= 0) return undefined;
  const idle = next.idle - prev.idle;
  return clampRatio((total - Math.max(0, idle)) / total);
}

export function probeMachineHardware(
  diskPath: string,
  platform: NodeJS.Platform = process.platform,
  readMemoryLevel: () => string = () =>
    execFileSync('sysctl', ['-n', 'kern.memorystatus_level'], {
      encoding: 'utf8',
      timeout: 2_000,
    }),
  cpuUtilization?: number,
): MachineHardware | undefined {
  try {
    const cpuCores = cpus().length;
    if (!Number.isInteger(cpuCores) || cpuCores < 1) return undefined;
    const free = diskFreeMb(diskPath);
    if (free === undefined) return undefined;
    const [load, load5] = loadavg();
    if (load === undefined || !Number.isFinite(load) || load < 0) return undefined;
    const memoryTotalMb = Math.max(0, Math.floor(totalmem() / (1024 * 1024)));
    const memory = memoryFigures(memoryTotalMb, platform, readMemoryLevel);
    return {
      cpuCores,
      memoryTotalMb,
      ...memory,
      loadAvg1: load,
      ...(load5 !== undefined && Number.isFinite(load5) && load5 >= 0 ? { loadAvg5: load5 } : {}),
      ...(cpuUtilization !== undefined ? { cpuUtilization } : {}),
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
    ...probeDeviceName(),
    mcpServers: scanMcpSlugs(sources.mcpConfigPath),
    skills: scanSkillNames(sources.skillsDir).filter(
      (name) => name !== 'agent-reach' || agentReachEnabled(),
    ),
    ...(hardware !== undefined ? { hardware } : {}),
  };
}

export interface MachineCapabilityProbeOptions {
  readCpus?: () => CpuInfo[];
}

export function createMachineCapabilitiesProbe(
  sources: MachineCapabilitySources,
  options: MachineCapabilityProbeOptions = {},
): () => MachineCapabilities {
  let mcpCache: { mtimeMs: number; value: string[] } | null = null;
  let skillsCache: { mtimeMs: number; value: string[] } | null = null;
  const deviceName = probeDeviceName();
  const readCpus = options.readCpus ?? cpus;
  let cpuWindow = cpuWindowOf(readCpus);
  let lastCpuUtilization: number | undefined;

  const cpuUtilization = (): number | undefined => {
    const next = cpuWindowOf(readCpus);
    const coreCount = Math.max(1, readCpus().length);
    if (next.total - cpuWindow.total < coreCount * CPU_WINDOW_MIN_MS) return lastCpuUtilization;
    lastCpuUtilization = cpuUtilizationBetween(cpuWindow, next);
    cpuWindow = next;
    return lastCpuUtilization;
  };

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
    const hardware = probeMachineHardware(
      sources.skillsDir,
      process.platform,
      undefined,
      cpuUtilization(),
    );
    const osDistribution = probeOsDistribution();
    return {
      osPlatform: osPlatformOf(process.platform),
      ...(osDistribution !== undefined ? { osDistribution } : {}),
      ...deviceName,
      mcpServers: mcpCache.value,
      skills: skillsCache.value.filter((name) => name !== 'agent-reach' || agentReachEnabled()),
      ...(hardware !== undefined ? { hardware } : {}),
    };
  };
}
