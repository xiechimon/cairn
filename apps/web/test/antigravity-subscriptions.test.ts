import { describe, expect, test } from 'vitest';
import {
  defaultRunnerTarget,
  extractAntigravityToken,
  localAntigravityTarget,
} from '../src/api/antigravity-subscriptions.js';

describe('extractAntigravityToken', () => {
  test('returns a bare token unchanged', () => {
    expect(extractAntigravityToken('  AIzaSyRealKey1234567890  ')).toBe('AIzaSyRealKey1234567890');
  });

  test('pulls GEMINI_API_KEY out of a pasted .env snippet', () => {
    const snippet = 'FOO=bar\nexport GEMINI_API_KEY="AIzaSyEnvKey1234567890"\nBAZ=1';
    expect(extractAntigravityToken(snippet)).toBe('AIzaSyEnvKey1234567890');
  });

  test('pulls apiKey from a pasted JSON object', () => {
    expect(extractAntigravityToken('{"apiKey":"AIzaSyJsonKey1234567890"}')).toBe(
      'AIzaSyJsonKey1234567890',
    );
  });

  test('leaves unrelated text untouched for server validation', () => {
    expect(extractAntigravityToken('short')).toBe('short');
  });
});

describe('defaultRunnerTarget', () => {
  const localMac = { id: 'm-local', name: 'xmonsMac', kind: 'local' as const, online: true };
  const macMini = { id: 'm-mini', name: 'Ians-Mac-mini', kind: 'remote' as const, online: true };

  test('names the default runner when it is another computer', () => {
    expect(defaultRunnerTarget([localMac, macMini], macMini.id)).toEqual({
      isThisComputer: false,
      label: 'Ians-Mac-mini',
    });
  });

  test('uses this computer when the default runner is the local Mac', () => {
    expect(defaultRunnerTarget([localMac, macMini], localMac.id)).toEqual({
      isThisComputer: true,
      label: null,
    });
  });

  test('uses localRunnerId when available to match this computer', () => {
    expect(defaultRunnerTarget([localMac, macMini], macMini.id, macMini.id)).toEqual({
      isThisComputer: true,
      label: null,
    });
    expect(defaultRunnerTarget([localMac, macMini], localMac.id, macMini.id)).toEqual({
      isThisComputer: false,
      label: 'xmonsMac',
    });
  });

  test('falls back to this computer when no machines are loaded', () => {
    expect(defaultRunnerTarget(undefined, null)).toEqual({
      isThisComputer: true,
      label: null,
    });
    expect(defaultRunnerTarget([], null)).toEqual({
      isThisComputer: true,
      label: null,
    });
  });

  test('uses computerName when hostname matches the machine name', () => {
    const mini = {
      ...macMini,
      name: 'ians-mac-mini.local',
      capabilities: { hostname: 'ians-mac-mini.local', computerName: 'Ians-Mac-mini' },
    };
    expect(defaultRunnerTarget([localMac, mini], mini.id)).toEqual({
      isThisComputer: false,
      label: 'Ians-Mac-mini',
    });
  });

  test('localAntigravityTarget binds to this computer whenever localRunnerId is present', () => {
    expect(localAntigravityTarget([localMac, macMini], macMini.id, localMac.id)).toEqual({
      isThisComputer: true,
      label: null,
    });
    expect(localAntigravityTarget([localMac, macMini], macMini.id, undefined)).toEqual({
      isThisComputer: false,
      label: 'Ians-Mac-mini',
    });
  });
});
