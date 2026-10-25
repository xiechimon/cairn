import { describe, expect, test } from 'vitest';
import {
  claudeCodeReportSchema,
  modelSourcesEnvelopeSchema,
  parseClaudeCodeModelSource,
} from '../src/records/model-source.js';

describe('parseClaudeCodeModelSource', () => {
  test('model + env slot parsing (mid-segment lowercasing, non-slot keys skipped)', () => {
    const source = parseClaudeCodeModelSource(
      {
        model: 'claude-opus-4-5',
        env: {
          ANTHROPIC_OPUS_MODEL: 'claude-opus-4-1',
          ANTHROPIC_SMALL_FAST_MODEL: 'claude-haiku-4-5',
          ANTHROPIC_BASE_URL: 'https://not-a-model-slot.example.com',
        },
      },
      'exec-1',
    );
    expect(source).toEqual({
      runtime: 'claude-code',
      installed: true,
      hostname: 'exec-1',
      models: [
        { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' },
        { id: 'claude-opus-4-1', name: 'claude-opus-4-1', slot: 'opus' },
        { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5', slot: 'small-fast' },
      ],
    });
  });

  test('JSON string input follows the same rule (daemon feeds the raw file content)', () => {
    const source = parseClaudeCodeModelSource(JSON.stringify({ model: 'm-1' }), 'exec-1');
    expect(source.installed).toBe(true);
    expect(source.models).toEqual([{ id: 'm-1', name: 'm-1', slot: 'default' }]);
  });

  test('missing/invalid/non-object -> installed:false (no throw)', () => {
    for (const raw of [null, undefined, '{ not json', '["m-1"]', '42', '']) {
      const source = parseClaudeCodeModelSource(raw, 'exec-1');
      expect(source).toEqual({
        runtime: 'claude-code',
        installed: false,
        hostname: 'exec-1',
        models: [],
      });
    }
  });

  test('non-string/empty slot values skip that slot, installed still true', () => {
    const source = parseClaudeCodeModelSource(
      { model: '', env: { ANTHROPIC_OPUS_MODEL: 42, ANTHROPIC_SONNET_MODEL: 'claude-sonnet-5' } },
      'exec-1',
    );
    expect(source.installed).toBe(true);
    expect(source.models).toEqual([
      { id: 'claude-sonnet-5', name: 'claude-sonnet-5', slot: 'sonnet' },
    ]);
  });

  test('model alias resolved to a real name via ANTHROPIC_DEFAULT_*_MODEL (#1287)', () => {
    const source = parseClaudeCodeModelSource(
      {
        model: 'fable',
        env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'deepseek-v4.1-flash[1M]' },
      },
      'exec-1',
    );
    expect(source.models).toEqual([
      { id: 'deepseek-v4.1-flash[1M]', name: 'deepseek-v4.1-flash[1M]', slot: 'default' },
    ]);
  });

  test('model alias without mapping -> falls back to the raw value (#1287)', () => {
    const source = parseClaudeCodeModelSource({ model: 'fable' }, 'exec-1');
    expect(source.models).toEqual([{ id: 'fable', name: 'fable', slot: 'default' }]);
  });

  test('alias resolution and slot entry with the same id -> dedup keeps only the default row (#1287)', () => {
    const source = parseClaudeCodeModelSource(
      {
        model: 'fable',
        env: {
          ANTHROPIC_DEFAULT_FABLE_MODEL: 'deepseek-v4.1-flash[1M]',
          ANTHROPIC_SONNET_MODEL: 'deepseek-v4.1-flash[1M]',
        },
      },
      'exec-1',
    );
    expect(source.models).toEqual([
      { id: 'deepseek-v4.1-flash[1M]', name: 'deepseek-v4.1-flash[1M]', slot: 'default' },
    ]);
  });

  test('model written as a real name without alias -> kept verbatim, env slots as usual (#1287)', () => {
    const source = parseClaudeCodeModelSource(
      {
        model: 'claude-opus-4-5',
        env: { ANTHROPIC_OPUS_MODEL: 'claude-opus-4-1' },
      },
      'exec-1',
    );
    expect(source.models).toEqual([
      { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' },
      { id: 'claude-opus-4-1', name: 'claude-opus-4-1', slot: 'opus' },
    ]);
  });

  test('multiple env slots mapping to the same id -> dedup by id (#1287)', () => {
    const source = parseClaudeCodeModelSource(
      {
        env: {
          ANTHROPIC_OPUS_MODEL: 'claude-opus-4-1',
          ANTHROPIC_SONNET_MODEL: 'claude-opus-4-1',
          ANTHROPIC_HAIKU_MODEL: 'claude-haiku-4-5',
        },
      },
      'exec-1',
    );
    expect(source.models).toEqual([
      { id: 'claude-opus-4-1', name: 'claude-opus-4-1', slot: 'opus' },
      { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5', slot: 'haiku' },
    ]);
  });

  test('report payload round-trip: report -> segments (hostname/model verbatim)', () => {
    const source = parseClaudeCodeModelSource({ model: 'm-1' }, 'exec-1');
    const report = claudeCodeReportSchema.parse({
      installed: source.installed,
      hostname: source.hostname,
      models: source.models,
    });
    const envelope = modelSourcesEnvelopeSchema.parse({
      sources: [
        { runtime: 'pi', installed: true, hostname: 'server-1', models: [] },
        { runtime: 'claude-code', ...report },
      ],
    });
    expect(envelope.sources).toHaveLength(2);
    expect(envelope.sources[1]?.hostname).toBe('exec-1');
  });
});
