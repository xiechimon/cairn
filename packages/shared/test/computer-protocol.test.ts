import { describe, expect, it } from 'vitest';
import {
  COMPUTER_REPLAY_SAFE_TOOLS,
  COMPUTER_TOOLS,
  machineStreamEventSchema,
  machineToolRelayResponseSchema,
} from '../src/index.js';

const image = { data: 'iVBORw0KGgo=', mimeType: 'image/png' };

describe('computer protocol (D75)', () => {
  it('relay responses carry images next to the text, and old text-only responses still parse', () => {
    expect(machineToolRelayResponseSchema.parse({ text: 'ok', images: [image] })).toEqual({
      text: 'ok',
      images: [image],
    });
    expect(machineToolRelayResponseSchema.parse({ text: 'ok' })).toEqual({ text: 'ok' });
  });

  it('relay images are limited in count, type and encoding', () => {
    const five = Array.from({ length: 5 }, () => image);
    expect(machineToolRelayResponseSchema.safeParse({ text: '', images: five }).success).toBe(
      false,
    );
    expect(
      machineToolRelayResponseSchema.safeParse({
        text: '',
        images: [{ ...image, mimeType: 'image/svg+xml' }],
      }).success,
    ).toBe(false);
    expect(
      machineToolRelayResponseSchema.safeParse({
        text: '',
        images: [{ ...image, data: '<script>' }],
      }).success,
    ).toBe(false);
  });

  it('a computer stream event names a known tool and a hashed call id', () => {
    const call = { callId: 'b'.repeat(64), stepId: 's', tool: 'shell', params: {}, deadlineAt: 1 };
    expect(machineStreamEventSchema.safeParse({ type: 'computer', call }).success).toBe(true);
    expect(
      machineStreamEventSchema.safeParse({ type: 'computer', call: { ...call, tool: 'rm_rf' } })
        .success,
    ).toBe(false);
    expect(
      machineStreamEventSchema.safeParse({ type: 'computer', call: { ...call, callId: 'x' } })
        .success,
    ).toBe(false);
  });

  it('only read tools are replay-safe', () => {
    for (const tool of COMPUTER_REPLAY_SAFE_TOOLS) {
      expect(COMPUTER_TOOLS).toContain(tool);
      expect(tool).toMatch(/^(list_files|read_file|.*observe|browser_snapshot)$/);
    }
    expect(COMPUTER_REPLAY_SAFE_TOOLS.has('shell')).toBe(false);
    expect(COMPUTER_REPLAY_SAFE_TOOLS.has('user_computer_act')).toBe(false);
  });
});
