import { basename } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agentMemory, project } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { RepoCtx } from './git.js';
import { readFile, readFiles } from './git.js';
import { executeMemoryDocumentTool } from './memory-documents.js';
import { listedProjects } from './personal-space.js';
import { coordinatorMemoryOwner } from './routing-rules.js';

const IMPORT_BASENAMES = new Set(['CLAUDE.MD', 'AGENTS.MD']);
const IMPORT_SOURCE_PREFIX = 'import:';

export interface MemoryImportCandidate {
  projectId: string;
  projectName: string;
  file: string;
  imported: boolean;
}

export interface RepoReader {
  list(projectId: string): Promise<{ path: string }[]>;
  read(projectId: string, path: string): Promise<{ content: string; encoding: string }>;
}

export function repoReaderOf(ctx: RepoCtx): RepoReader {
  return {
    list: async (projectId) => (await readFiles(ctx, projectId, undefined, '5000')).files,
    read: async (projectId, path) => readFile(ctx, projectId, path),
  };
}

export function isMemoryImportFile(path: string): boolean {
  return IMPORT_BASENAMES.has(basename(path).toUpperCase());
}

export function memoryImportSource(file: string): string {
  return `${IMPORT_SOURCE_PREFIX}${file}`;
}

export async function listMemoryImportCandidates(
  db: Db,
  teamId: string,
  repo: RepoReader,
): Promise<MemoryImportCandidate[]> {
  const projects = db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(and(eq(project.teamId, teamId), listedProjects(teamId)))
    .all();
  const imported = new Set(
    db
      .select({ projectId: agentMemory.projectId, source: agentMemory.source })
      .from(agentMemory)
      .where(eq(agentMemory.teamId, teamId))
      .all()
      .filter((r) => r.source?.startsWith(IMPORT_SOURCE_PREFIX))
      .map((r) => `${r.projectId ?? 'team'}:${r.source}`),
  );
  const out: MemoryImportCandidate[] = [];
  for (const p of projects) {
    let files: { path: string }[];
    try {
      files = await repo.list(p.id);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!isMemoryImportFile(f.path)) continue;
      out.push({
        projectId: p.id,
        projectName: p.name,
        file: f.path,
        imported: imported.has(`${p.id}:${memoryImportSource(f.path)}`),
      });
    }
  }
  return out;
}

export async function importMemoryFile(
  db: Db,
  teamId: string,
  body: { projectId: string; file: string },
  repo: RepoReader,
): Promise<unknown> {
  if (!isMemoryImportFile(body.file))
    throw new HttpError(400, `not an importable memory file: ${body.file}`);
  const file = await repo.read(body.projectId, body.file);
  if (file.encoding !== 'utf-8')
    throw new HttpError(422, `binary file cannot be imported: ${body.file}`);
  const agentId = coordinatorMemoryOwner(db, teamId);
  if (agentId === undefined)
    throw new HttpError(409, 'Coordinator memory is not configured for this team');
  return executeMemoryDocumentTool(
    db,
    {
      teamId,
      agentId,
      projectId: body.projectId,
      source: memoryImportSource(body.file),
    },
    'save_memory',
    { scope: body.projectId, file: basename(body.file), content: file.content },
  );
}
