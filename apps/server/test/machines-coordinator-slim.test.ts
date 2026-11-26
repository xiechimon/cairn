import { afterEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { machine as machineTable } from '../src/db/schema.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { bootServer, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

function toolDepsOf(s: TestServer) {
  return {
    db: s.db,
    hub: s.hub,
    machineHub: s.machineHub,
    box: s.secretBox,
    user: s.user,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
}

function toolCtxOf(s: TestServer) {
  return {
    teamId: s.team.id,
    userId: s.user.id,
    chiefId: 'chief-1',
    threadId: 'chief-thread-1',
    chiefAgentId: 'agent-1',
    conversationId: 'chief-thread-1',
  };
}

describe('machines tool output slimming for Coordinator', () => {
  test('strips heavy/internal capability fields on online machines and omits capability trees on offline machines', async () => {
    const s = bootServer();
    servers.push(s);
    const manySkills = Array.from({ length: 120 }, (_, i) => `skill-${i}`);
    const manyDevinModels = Array.from({ length: 80 }, (_, i) => ({
      id: `devin-model-${i}`,
      name: `Devin Model ${i}`,
    }));
    const manyAgModels = Array.from({ length: 120 }, (_, i) => ({
      id: `gemini-model-${i}`,
      name: `Gemini Model ${i}`,
      thinkingLevels: ['low', 'medium', 'high'],
      thinkingDefault: 'medium',
    }));

    s.db
      .insert(machineTable)
      .values([
        readyMachine({
          id: 'online-mac',
          teamId: s.team.id,
          name: 'Studio-Mac-mini',
          online: true,
          latestCliVersion: '0.5.0',
          capabilities: {
            osPlatform: 'darwin',
            osDistribution: 'macos',
            computerName: 'Studio Mac',
            hostname: 'Studio-Mac-mini.local',
            executor: 'host',
            computer: true,
            ownComputer: true,
            ownComputerShell: true,
            browser: true,
            browserSecretFill: true,
            stealthBrowser: true,
            screenHandoff: true,
            mcpConnectors: true,
            phoneHost: true,
            computerKind: 'host',
            secretGateway: true,
            claimGeneration: true,
            runnerProtocolVersion: 1,
            mcpServers: ['figma'],
            skills: manySkills,
            hardware: {
              cpuCores: 16,
              memoryTotalMb: 65536,
              memoryAvailableMb: 32768,
              loadAvg1: 1.25,
              diskFreeMb: 512000,
            },
            confinement: {
              state: 'ready',
              invocation: '11111111-1111-4111-8111-111111111111',
              generation: 2,
              revision: 5,
            },
            hostPermissions: {
              accessibility: 'granted',
              automation: 'granted',
              screenRecording: 'granted',
            },
            vmDownload: { status: 'ready', bytes: 1024 },
            phones: [{ deviceId: 'dev-1', platform: 'ios', name: 'iPhone', link: 'ready' }],
            codexLogin: { state: 'ok', expiresAt: 1_900_000_000_000 },
            agentReach: {
              version: '1.6.1',
              channels: [{ channel: 'x', status: 'ok' }],
            },
            scrapling: { version: '0.5.1' },
            devin: {
              installed: true,
              version: '1.2.0',
              models: manyDevinModels,
              update: { installedVersion: '1.2.0', availableVersion: null, phase: 'idle' },
            },
            gemini: {
              installed: true,
              version: '0.9.0',
              update: { installedVersion: '0.9.0', availableVersion: null, phase: 'idle' },
            },
            antigravity: {
              installed: true,
              authenticated: true,
              version: '1.5.18',
              source: 'local',
              models: manyAgModels,
            },
            claude: {
              installed: true,
              version: '2.1.0',
              models: [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }],
            },
            codex: {
              installed: true,
              version: '1.0.0',
              models: [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }],
            },
          } as never,
        }),
        readyMachine({
          id: 'offline-mac',
          teamId: s.team.id,
          name: 'Old-MacBook',
          online: false,
          latestCliVersion: '0.4.0',
          capabilities: {
            osPlatform: 'darwin',
            computerName: 'Old MacBook',
            hostname: 'old-mac.local',
            executor: 'host',
            computer: true,
            mcpServers: ['figma', 'github'],
            skills: manySkills,
            hardware: {
              cpuCores: 8,
              memoryAvailableMb: 4096,
              loadAvg1: 0.5,
              diskFreeMb: 20000,
            },
            devin: { installed: true, version: '1.0.0', models: manyDevinModels },
            antigravity: { installed: true, authenticated: true, models: manyAgModels },
          } as never,
        }),
      ])
      .run();

    const raw = await executeChiefTool(toolDepsOf(s), toolCtxOf(s), 'machines', {});
    const rows = JSON.parse(raw) as Array<{
      id: string;
      name: string;
      online: boolean;
      latestCliVersion: string | null;
      capabilities: Record<string, unknown> | null;
    }>;

    const onlineRow = rows.find((r) => r.id === 'online-mac');
    expect(onlineRow).toBeDefined();
    expect(onlineRow?.capabilities).toEqual({
      osPlatform: 'darwin',
      computerName: 'Studio Mac',
      hostname: 'Studio-Mac-mini.local',
      executor: 'host',
      computer: true,
      ownComputer: true,
      ownComputerShell: true,
      browser: true,
      browserSecretFill: true,
      stealthBrowser: true,
      screenHandoff: true,
      mcpConnectors: true,
      phoneHost: true,
      mcpServers: ['figma'],
      agentReach: {
        version: '1.6.1',
        channels: [{ channel: 'x', status: 'ok' }],
      },
      scrapling: { version: '0.5.1' },
      devin: { installed: true, version: '1.2.0' },
      gemini: { installed: true, version: '0.9.0' },
      antigravity: { installed: true, authenticated: true, version: '1.5.18' },
    });

    for (const removedKey of [
      'hardware',
      'confinement',
      'vmDownload',
      'hostPermissions',
      'computerKind',
      'skills',
      'phones',
      'codexLogin',
      'claude',
      'codex',
      'osDistribution',
      'secretGateway',
      'claimGeneration',
      'runnerProtocolVersion',
    ]) {
      expect(onlineRow?.capabilities).not.toHaveProperty(removedKey);
    }

    const offlineRow = rows.find((r) => r.id === 'offline-mac');
    expect(offlineRow).toEqual({
      id: 'offline-mac',
      name: 'Old-MacBook',
      online: false,
      latestCliVersion: '0.4.0',
      capabilities: null,
    });
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThan(2048);
  });
});
