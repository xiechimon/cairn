import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { boot, FakeMachineApi, waitFor } from './machine-loop-harness.js';

describe('online sequence canon (02 §5.4/r3 §1.5)', () => {
  test('unregistered → enroll → full sequence line order', async () => {
    const { handle, api, lines, paths } = await boot({});
    await waitFor(() => lines.some((l) => l.includes('[wake] push channel connected')));
    expect(lines[0]).toBe('Loading pi runtime…');
    expect(lines).toContain('Enrolled in team team-1 (machine m1)');
    expect(lines.some((l) => l === 'Online (machineId=m1); polling http://server')).toBe(true);
    expect(lines).toContain('[recover] no pending steps found');
    expect(lines).toContain('[wake] push channel connected');
    const idx = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(idx('Loading pi runtime')).toBeLessThan(idx('Online (machineId'));
    expect(idx('Online (machineId')).toBeLessThan(idx('[recover]'));
    expect(idx('[recover]')).toBeLessThan(idx('[wake] push channel connected'));
    expect(existsSync(paths.machineJson)).toBe(true);
    expect(JSON.parse(readFileSync(paths.machineJson, 'utf8')).machineId).toBe('m1');
    expect(api.calls[0]).toBe('enroll:team-1');
    const enrollBody = api.enrollBodies[0] as { claudeCode?: unknown };
    const report = enrollBody.claudeCode as {
      installed: boolean;
      hostname: string;
      models: unknown[];
    };
    expect(typeof report.installed).toBe('boolean');
    expect(typeof report.hostname).toBe('string');
    expect(report.hostname).not.toBe('');
    expect(Array.isArray(report.models)).toBe(true);
    await waitFor(() => api.presenceBodies.length > 0);
    expect((api.presenceBodies[0] as { claudeCode?: unknown }).claudeCode !== undefined).toBe(true);
    const caps = (enrollBody as { capabilities?: unknown }).capabilities as {
      mcpServers: unknown;
      skills: unknown;
    };
    expect(Array.isArray(caps.mcpServers)).toBe(true);
    expect(Array.isArray(caps.skills)).toBe(true);
    expect((api.presenceBodies[0] as { capabilities?: unknown }).capabilities !== undefined).toBe(
      true,
    );
    await handle.stop();
    await handle.done;
    expect(lines).toContain('[machine] Shutting down…');
  });

  test('#1251 capability manifest uploaded with enroll and every presence beat (injected stub pins content)', async () => {
    const { handle, api } = await boot({
      capabilitiesProbe: () => ({ mcpServers: ['figma'], skills: ['verify-cairn'] }),
    });
    await waitFor(() => api.presenceBodies.length > 0);
    expect((api.enrollBodies[0] as { capabilities?: unknown }).capabilities).toEqual({
      mcpServers: ['figma'],
      skills: ['verify-cairn'],
    });
    expect((api.presenceBodies[0] as { capabilities?: unknown }).capabilities).toEqual({
      mcpServers: ['figma'],
      skills: ['verify-cairn'],
    });
    await handle.stop();
    await handle.done;
  });

  test('stop(cause) exit line carries a cause suffix (#691: signal name on record)', async () => {
    const { handle, lines } = await boot({});
    await waitFor(() => lines.some((l) => l.includes('[wake] push channel connected')));
    await handle.stop('SIGTERM');
    await handle.done;
    expect(lines).toContain('[machine] Shutting down… (SIGTERM)');
  });
});

describe('server migration diagnosis (#519 control-plane move: machine.json serverUrl from registration differs from the current config)', () => {
  test('failure mode: old machine.json + new CAIRN_SERVER → startup warning line (contains both addresses and re-registration guidance), still goes online', async () => {
    const api = new FakeMachineApi();
    const { handle, lines } = await boot({
      api,
      preEnrolled: { serverUrl: 'http://old-host:8787' },
    });
    await waitFor(() =>
      lines.some((l) => l.includes('Online (machineId=m-old); polling http://server')),
    );
    const warn = lines.find((l) => l.includes('[machine]') && l.includes('re-enroll'));
    expect(warn).toBeDefined();
    expect(warn).toContain('http://old-host:8787');
    expect(warn).toContain('http://server');
    expect(api.calls).not.toContain('enroll:team-1');
    await handle.stop();
    await handle.done;
  });

  test('consistent (or unregistered) → no such warning line', async () => {
    const api = new FakeMachineApi();
    const { handle, lines } = await boot({ api, preEnrolled: { serverUrl: 'http://server' } });
    await waitFor(() => lines.some((l) => l.includes('Online (machineId=m-old)')));
    expect(lines.some((l) => l.includes('re-enroll'))).toBe(false);
    await handle.stop();
    await handle.done;
  });
});
