import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type SkillSourceKind = 'localPath' | 'github';

export interface SkillSourceRecord {
  skillId: string;
  kind: SkillSourceKind;
  ref: string;
  importedAt: number;
  refreshedAt: number | null;
}

interface SkillSourcesFile {
  version: 1;
  sources: Record<string, SkillSourceRecord>;
}

function emptyFile(): SkillSourcesFile {
  return { version: 1, sources: {} };
}

function readFile(path: string): SkillSourcesFile {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return emptyFile();
  }
  try {
    const parsed = JSON.parse(raw) as SkillSourcesFile;
    if (parsed.version !== 1 || typeof parsed.sources !== 'object' || parsed.sources === null) {
      return emptyFile();
    }
    return { version: 1, sources: { ...parsed.sources } };
  } catch {
    return emptyFile();
  }
}

let writeChain: Promise<void> = Promise.resolve();

function writeFileAtomic(path: string, file: SkillSourcesFile): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(tmp, path);
}

export function readSkillSource(path: string, skillId: string): SkillSourceRecord | null {
  return readFile(path).sources[skillId] ?? null;
}

export function writeSkillSource(path: string, record: SkillSourceRecord): Promise<void> {
  const task = writeChain.then(() => {
    const file = readFile(path);
    writeFileAtomic(path, {
      version: 1,
      sources: { ...file.sources, [record.skillId]: record },
    });
  });
  writeChain = task.catch(() => {});
  return task;
}
