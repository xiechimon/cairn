import { describe, expect, test } from 'vitest';
import {
  BRIEF_BACKEND_IDS,
  BRIEF_CANDIDATES,
  BRIEF_CREATE_NAME,
  BRIEF_MANAGED_SEPARATOR,
  BRIEF_MARKER_BEGIN,
  BRIEF_MARKER_END,
  briefBackendForProvider,
  resolveBriefTarget,
} from '../src/brief-file.js';

const CI = { caseInsensitiveFs: true };
const CS = { caseInsensitiveFs: false };

describe('resolveBriefTarget: target decision table (gate 2)', () => {
  test('empty directory -> each backend creates its own standard name', () => {
    expect(resolveBriefTarget([], 'pi', CI)).toEqual({ file: 'AGENTS.md', mode: 'create' });
    expect(resolveBriefTarget([], 'claude-code', CI)).toEqual({
      file: 'CLAUDE.md',
      mode: 'create',
    });
  });

  test('only CLAUDE.md -> pi appends into it, never creates AGENTS.md (failure mode 1: shadowing)', () => {
    expect(resolveBriefTarget(['CLAUDE.md'], 'pi', CI)).toEqual({
      file: 'CLAUDE.md',
      mode: 'append',
    });
    expect(resolveBriefTarget(['CLAUDE.md'], 'claude-code', CI)).toEqual({
      file: 'CLAUDE.md',
      mode: 'append',
    });
  });

  test('only AGENTS.md -> pi appends into it; claude-code creates CLAUDE.md (the SDK does not read AGENTS.md)', () => {
    expect(resolveBriefTarget(['AGENTS.md'], 'pi', CI)).toEqual({
      file: 'AGENTS.md',
      mode: 'append',
    });
    expect(resolveBriefTarget(['AGENTS.md'], 'claude-code', CI)).toEqual({
      file: 'CLAUDE.md',
      mode: 'create',
    });
  });

  test('both present -> each takes the first match in its own order', () => {
    expect(resolveBriefTarget(['CLAUDE.md', 'AGENTS.md'], 'pi', CI)).toEqual({
      file: 'AGENTS.md',
      mode: 'append',
    });
    expect(resolveBriefTarget(['CLAUDE.md', 'AGENTS.md'], 'claude-code', CI)).toEqual({
      file: 'CLAUDE.md',
      mode: 'append',
    });
  });

  test('AGENTS.override.md wins over everything -> pi must write into it (failure mode 2: invisible)', () => {
    expect(resolveBriefTarget(['AGENTS.override.md'], 'pi', CI)).toEqual({
      file: 'AGENTS.override.md',
      mode: 'append',
    });
    expect(resolveBriefTarget(['AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md'], 'pi', CI)).toEqual({
      file: 'AGENTS.override.md',
      mode: 'append',
    });
    expect(resolveBriefTarget(['AGENTS.override.md'], 'claude-code', CI)).toEqual({
      file: 'CLAUDE.md',
      mode: 'create',
    });
  });

  test('case-insensitive disk: CLAUDE.MD satisfies the CLAUDE.md candidate; the write target uses the real on-disk spelling (failure modes 3/5)', () => {
    expect(resolveBriefTarget(['CLAUDE.MD'], 'pi', CI)).toEqual({
      file: 'CLAUDE.MD',
      mode: 'append',
    });
    expect(resolveBriefTarget(['CLAUDE.MD'], 'claude-code', CI)).toEqual({
      file: 'CLAUDE.MD',
      mode: 'append',
    });
    expect(resolveBriefTarget(['agents.MD'], 'pi', CI)).toEqual({
      file: 'agents.MD',
      mode: 'append',
    });
  });

  test("case-sensitive disk: CLAUDE.MD still hit by pi's 5th candidate, but claude-code creates another CLAUDE.md", () => {
    expect(resolveBriefTarget(['CLAUDE.MD'], 'pi', CS)).toEqual({
      file: 'CLAUDE.MD',
      mode: 'append',
    });
    expect(resolveBriefTarget(['CLAUDE.MD'], 'claude-code', CS)).toEqual({
      file: 'CLAUDE.md',
      mode: 'create',
    });
  });

  test('case-sensitive disk: all-lowercase claude.md hits neither side -> pi creates AGENTS.md (the brief must be visible)', () => {
    expect(resolveBriefTarget(['claude.md'], 'pi', CS)).toEqual({
      file: 'AGENTS.md',
      mode: 'create',
    });
    expect(resolveBriefTarget(['claude.md'], 'claude-code', CS)).toEqual({
      file: 'CLAUDE.md',
      mode: 'create',
    });
  });

  test('unrelated files do not affect the judgment', () => {
    const entries = ['README.md', 'package.json', 'src', '.git'];
    expect(resolveBriefTarget(entries, 'pi', CI)).toEqual({ file: 'AGENTS.md', mode: 'create' });
    expect(resolveBriefTarget(entries, 'claude-code', CS)).toEqual({
      file: 'CLAUDE.md',
      mode: 'create',
    });
  });
});

describe('briefBackendForProvider: same source as runner backendFor (failure mode 4)', () => {
  test('runtime identity vocabulary -> matching backend; everything else pi', () => {
    expect(briefBackendForProvider('claude-code')).toBe('claude-code');
    expect(briefBackendForProvider('gemini')).toBe('gemini');
    expect(briefBackendForProvider('pi')).toBe('pi');
    expect(briefBackendForProvider('stub-gw')).toBe('pi');
    expect(briefBackendForProvider(null)).toBe('pi');
    expect(briefBackendForProvider(undefined)).toBe('pi');
  });

  test('gemini briefs use GEMINI.md', () => {
    expect(resolveBriefTarget([], 'gemini', CI)).toEqual({ file: 'GEMINI.md', mode: 'create' });
  });
});

describe("the vocabulary's own shape constraints", () => {
  test('every backend has a candidate order and a new-file name, and the new-file name is in the candidate order', () => {
    for (const backend of BRIEF_BACKEND_IDS) {
      expect(BRIEF_CANDIDATES[backend].length).toBeGreaterThan(0);
      expect(BRIEF_CANDIDATES[backend]).toContain(BRIEF_CREATE_NAME[backend]);
    }
  });

  test('the marker string is an HTML comment (inert in the renderer) and never appears twice in the same string', () => {
    expect(BRIEF_MARKER_BEGIN.startsWith('<!--')).toBe(true);
    expect(BRIEF_MARKER_BEGIN.endsWith('-->')).toBe(true);
    expect(BRIEF_MARKER_END.startsWith('<!--')).toBe(true);
    expect(BRIEF_MARKER_END.endsWith('-->')).toBe(true);
    expect(BRIEF_MARKER_BEGIN).not.toBe(BRIEF_MARKER_END);
    expect(BRIEF_MANAGED_SEPARATOR.length).toBeGreaterThan(0);
  });
});
