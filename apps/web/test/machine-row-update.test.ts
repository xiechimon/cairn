import type { MachineCapabilities } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { EN } from '../src/i18n/en.js';
import { translate, type TFunc } from '../src/i18n/translate.js';

const en: TFunc = (key, vars) => translate('en', EN, key, vars);
const zh: TFunc = (key, vars) => translate('zh', EN, key, vars);

describe('runnerUpdateSummary in MachineRowView', () => {
  it('shows single-line auto-update status, rollback notice, and read-only manual update copy', async () => {
    const mod = (await import('../src/resources/machine-row.js')) as Record<string, unknown>;
    expect(typeof mod.runnerUpdateSummary).toBe('function');
    const runnerUpdateSummary = mod.runnerUpdateSummary as (
      capabilities: MachineCapabilities | null | undefined,
      online: boolean,
      t: TFunc,
    ) => { text: string; tone: 'quiet' | 'error'; testId: string; outOfWindow?: boolean } | null;

    const downloading = runnerUpdateSummary(
      {
        mcpServers: [],
        skills: [],
        runnerProtocolVersion: 1,
        runnerReleaseVersion: '0.1.720',
        runnerAutoUpdate: { supported: true, state: 'downloading', targetVersion: '0.1.726' },
      },
      true,
      en,
    );
    expect(downloading).toMatchObject({
      tone: 'quiet',
      testId: 'machine-auto-update',
    });
    expect(downloading?.text).toContain('0.1.726');

    const waiting = runnerUpdateSummary(
      {
        mcpServers: [],
        skills: [],
        runnerProtocolVersion: 1,
        runnerReleaseVersion: '0.1.720',
        runnerAutoUpdate: { supported: true, state: 'waiting-idle', targetVersion: '0.1.726' },
      },
      true,
      zh,
    );
    expect(waiting).toMatchObject({
      tone: 'quiet',
      testId: 'machine-auto-update',
    });
    expect(waiting?.text).toContain('0.1.726');

    const rolledBack = runnerUpdateSummary(
      {
        mcpServers: [],
        skills: [],
        runnerProtocolVersion: 1,
        runnerReleaseVersion: '0.1.720',
        runnerAutoUpdate: {
          supported: true,
          state: 'rolled-back',
          reason: 'blocked',
          failedVersion: '0.1.726',
          restoredVersion: '0.1.720',
        },
      },
      true,
      en,
    );
    expect(rolledBack).toMatchObject({
      tone: 'error',
      testId: 'machine-auto-update',
    });
    expect(rolledBack?.text).toContain('0.1.726');
    expect(rolledBack?.text).toContain('0.1.720');

    const readOnlyOld = runnerUpdateSummary(
      {
        mcpServers: [],
        skills: [],
        runnerProtocolVersion: 0,
        runnerReleaseVersion: '0.1.710',
        runnerAutoUpdate: { supported: false, state: 'unsupported', reason: 'homebrew' },
      },
      true,
      en,
    );
    expect(readOnlyOld).toMatchObject({
      testId: 'machine-needs-update',
      text: 'Needs a Cairn update',
    });
  });
});
