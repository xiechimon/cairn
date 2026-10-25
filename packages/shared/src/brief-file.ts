import { isBackendRuntimeId } from './agent-backend.js';

export const BRIEF_MARKER_BEGIN = '<!-- BEGIN CAIRN-RUNTIME (auto-managed; do not edit) -->';
export const BRIEF_MARKER_END = '<!-- END CAIRN-RUNTIME -->';

export const BRIEF_MANAGED_SEPARATOR = '\n\n';

export const BRIEF_BACKEND_IDS = ['pi', 'claude-code', 'gemini'] as const;
export type BriefBackendId = (typeof BRIEF_BACKEND_IDS)[number];

export const BRIEF_CANDIDATES: Record<BriefBackendId, readonly string[]> = {
  pi: ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'],
  'claude-code': ['CLAUDE.md'],
  gemini: ['GEMINI.md'],
};

export const BRIEF_CREATE_NAME: Record<BriefBackendId, string> = {
  pi: 'AGENTS.md',
  'claude-code': 'CLAUDE.md',
  gemini: 'GEMINI.md',
};

export const BRIEF_RECONCILE_FILENAMES: readonly string[] = [
  ...new Set(BRIEF_BACKEND_IDS.flatMap((backend) => BRIEF_CANDIDATES[backend])),
];

export interface BriefTarget {
  file: string;
  mode: 'create' | 'append';
}

export function briefBackendForProvider(provider: string | null | undefined): BriefBackendId {
  if (provider === 'gemini') return 'gemini';
  return isBackendRuntimeId(provider) ? 'claude-code' : 'pi';
}

export function resolveBriefTarget(
  entries: readonly string[],
  backend: BriefBackendId,
  opts: { caseInsensitiveFs: boolean },
): BriefTarget {
  const realNameFor = new Map<string, string>();
  for (const name of entries) {
    const key = opts.caseInsensitiveFs ? name.toLowerCase() : name;
    if (!realNameFor.has(key)) realNameFor.set(key, name);
  }
  for (const candidate of BRIEF_CANDIDATES[backend]) {
    const key = opts.caseInsensitiveFs ? candidate.toLowerCase() : candidate;
    const real = realNameFor.get(key);
    if (real !== undefined) return { file: real, mode: 'append' };
  }
  return { file: BRIEF_CREATE_NAME[backend], mode: 'create' };
}
