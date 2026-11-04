import { MCP_CONNECT_FAILED_CANON } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { connectFailedLine } from '../src/backend/mcp-config.js';
import { parseMcpAttentionMessage } from '../src/backend/pi.js';

const ATTENTION = [
  'MCP servers need attention:',
  '  dead: failed: fetch failed',
  '  authsrv: needs sign-in',
  'Run /mcp to fix.',
].join('\n');

describe('parseMcpAttentionMessage（A1–A3）', () => {
  test('A1: attention block parsed line by line into (slug, reason)', () => {
    expect(parseMcpAttentionMessage(ATTENTION)).toEqual([
      { slug: 'dead', reason: 'failed: fetch failed' },
      { slug: 'authsrv', reason: 'needs sign-in' },
    ]);
  });
  test('A2: non-attention notifications and empty strings produce no lines', () => {
    expect(
      parseMcpAttentionMessage(
        'MCP servers are still connecting; their tools become available once connected.',
      ),
    ).toEqual([]);
    expect(parseMcpAttentionMessage('MCP failed to load: boom')).toEqual([]);
    expect(parseMcpAttentionMessage('')).toEqual([]);
  });
  test('A3: non-lines inside the block (no indentation) are skipped without crashing', () => {
    const msg = ['MCP servers need attention:', 'garbage line', '  ok: failed: x'].join('\n');
    expect(parseMcpAttentionMessage(msg)).toEqual([{ slug: 'ok', reason: 'failed: x' }]);
  });
});

describe('connectFailedLine (A4: canon line composition)', () => {
  test('line shape = `<slug>: <canon>: <reason>`', () => {
    const line = connectFailedLine('dead', 'failed: fetch failed');
    expect(line).toBe(`dead: ${MCP_CONNECT_FAILED_CANON}: failed: fetch failed`);
  });
  test('a line is still produced when reason is absent (canon prefix intact)', () => {
    const line = connectFailedLine('dead', '');
    expect(line).toBe(`dead: ${MCP_CONNECT_FAILED_CANON}: `);
  });
});
