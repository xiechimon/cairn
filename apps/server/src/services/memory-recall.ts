import { MEMORY_RECALL_HEADING } from '@cairn/shared';
import type { Db } from '../db/client.js';
import { project } from '../db/schema.js';
import { listMemoryEntries } from './memory.js';
import { listedProjects } from './personal-space.js';

export const RECALL_MAX_ENTRIES = 4;
const RECALL_MIN_TERMS = 2;
const RECALL_MIN_SCORE = 0.15;
const SUPPRESS_MAX = 512;

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function recallTerms(text: string): Set<string> {
  const terms = new Set<string>();
  const norm = text.normalize('NFKC').toLowerCase();
  for (const match of norm.matchAll(/[a-z0-9]+/g)) terms.add(match[0]);
  let run = '';
  const flush = () => {
    for (let i = 1; i < run.length; i++) terms.add(`${run[i - 1]}${run[i]}`);
    run = '';
  };
  for (const char of norm) {
    if (CJK_RE.test(char)) run += char;
    else flush();
  }
  flush();
  return terms;
}

interface Candidate {
  id: string;
  title: string;
  line: string;
  projectId: string | null;
  file: boolean;
}

function recallCandidates(
  db: Db,
  scope: { agentId: string; teamId: string },
  listable: ReadonlySet<string>,
): Candidate[] {
  return listMemoryEntries(db, { agentId: scope.agentId, teamId: scope.teamId })
    .filter((row) => row.layer === 'core' || row.layer === 'searchable')
    .filter((row) => row.projectId === null || listable.has(row.projectId))
    .map((row) => ({
      id: row.id,
      title: row.title,
      line: row.content.split('\n', 1)[0] ?? '',
      projectId: row.projectId,
      file: row.layer === 'searchable',
    }))
    .filter((candidate) => candidate.line !== '');
}

function scoreCandidate(queryTerms: ReadonlySet<string>, candidate: Candidate) {
  const titleTerms = recallTerms(candidate.title);
  const bodyTerms = recallTerms(candidate.line);
  let matched = 0;
  let titleHits = 0;
  for (const term of queryTerms) {
    if (bodyTerms.has(term) || titleTerms.has(term)) matched += 1;
    if (titleTerms.has(term)) titleHits += 1;
  }
  return {
    matched,
    score: (matched + titleHits) / Math.max(1, queryTerms.size),
  };
}

function alreadyInjected(candidate: Candidate, injectedTexts: readonly string[]): boolean {
  const forms = [
    `${candidate.title}：${candidate.line}`,
    ...(candidate.file ? [`](${encodeURIComponent(candidate.title)})`] : []),
  ];
  return injectedTexts.some((text) => forms.some((form) => form !== '' && text.includes(form)));
}

const recalledByThread = new WeakMap<Db, Map<string, Set<string>>>();

function recalledSet(db: Db, teamId: string, threadId: string): Set<string> {
  const key = `${teamId}${threadId}`;
  let map = recalledByThread.get(db);
  if (map === undefined) {
    map = new Map<string, Set<string>>();
    recalledByThread.set(db, map);
  }
  let set = map.get(key);
  if (set === undefined) {
    set = new Set();
    map.set(key, set);
  }
  return set;
}

function markRecalled(set: Set<string>, ids: readonly string[]): void {
  for (const id of ids) {
    if (set.has(id)) set.delete(id);
    set.add(id);
  }
  while (set.size > SUPPRESS_MAX) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
}

function scopeLabel(candidate: Candidate, projectNames: ReadonlyMap<string, string>): string {
  return candidate.projectId === null
    ? 'team'
    : `项目 · ${projectNames.get(candidate.projectId) ?? candidate.projectId}`;
}

export function recallMemorySection(
  db: Db,
  scope: { agentId: string; teamId: string; threadId: string },
  query: string,
  injectedTexts: readonly string[],
): { text: string; memoryIds: string[] } | null {
  const queryTerms = recallTerms(query);
  if (queryTerms.size === 0) return null;
  const seen = recalledSet(db, scope.teamId, scope.threadId);
  const projectNames = new Map(
    db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(listedProjects(scope.teamId))
      .all()
      .map((row) => [row.id, row.name]),
  );
  const hits = recallCandidates(db, scope, new Set(projectNames.keys()))
    .map((candidate) => ({ candidate, ...scoreCandidate(queryTerms, candidate) }))
    .filter((hit) => hit.matched >= RECALL_MIN_TERMS && hit.score >= RECALL_MIN_SCORE)
    .filter((hit) => !seen.has(hit.candidate.id))
    .filter((hit) => !alreadyInjected(hit.candidate, injectedTexts))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))
    .filter(
      (hit, index, ranked) =>
        ranked.findIndex(
          (other) =>
            other.candidate.title === hit.candidate.title &&
            other.candidate.line === hit.candidate.line,
        ) === index,
    )
    .slice(0, RECALL_MAX_ENTRIES);
  if (hits.length === 0) return null;
  markRecalled(
    seen,
    hits.map((hit) => hit.candidate.id),
  );
  const lines = hits.map((hit) => {
    const label = scopeLabel(hit.candidate, projectNames);
    return hit.candidate.file
      ? `- [${label}] ${hit.candidate.title} — ${hit.candidate.line}（memories file 读全文）`
      : `- [${label}] ${hit.candidate.title}：${hit.candidate.line}`;
  });
  return {
    text: [
      `${MEMORY_RECALL_HEADING}按本轮消息命中，先核对再用）`,
      ...lines,
      '命中的条目可能已过时或与当前问题无关，不切合直接忽略。',
    ].join('\n'),
    memoryIds: hits.map((hit) => hit.candidate.id),
  };
}
