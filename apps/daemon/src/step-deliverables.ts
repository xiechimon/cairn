import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  DELIVERABLE_LIMITS,
  type DeliverableCapability,
  type DeliverableKind,
  type MachineDoneBody,
} from '@cairn/shared';
import type { DaemonLogger } from './log.js';
import { type MachineApi, MachineApiError } from './machine-client.js';
import { ensurePrivateDir } from './private-fs.js';

const KIND_FOLDERS: { kind: DeliverableKind; folder: string; exts: readonly string[] }[] = [
  { kind: 'slides', folder: 'slides', exts: ['pptx', 'pdf'] },
  { kind: 'page', folder: 'pages', exts: ['html'] },
];
const MAX_FOLDER_ENTRIES = 64;
const UNSAFE_NAME = /[\p{Cc}\p{Cf}\p{Cs}/\\]/u;
const COPY_CHUNK_BYTES = 64 * 1024;
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PUT_ATTEMPTS = 4;
const PUT_BACKOFF_MS = 2_000;

export class DeliverableRejectedError extends Error {}

const COPY_NAME = /^\d+\.(?:html|pptx|pdf)$/;
const UPLOAD_PATH_PREFIX = '/api/machine/deliverable/';

export function ownsCopyDir(copyDir: string, stepId: string): boolean {
  return basename(copyDir) === `step-${stepId}.deliverables`;
}

export interface DeliverableFile {
  kind: DeliverableKind;
  name: string;
  size: number;
  sha256: string;
  path: string;
}

export interface DeliverableSkip {
  name: string;
  reason: string;
}

export interface DeliverableSnapshot {
  generation: number;
  copyDir: string;
  files: DeliverableFile[];
  skipped: DeliverableSkip[];
}

export type DeliverableDoneFields = Required<
  Pick<MachineDoneBody, 'generation' | 'deliverables' | 'deliverablesSkipped'>
>;

export function deliverablesDirOf(reportFile: string): string {
  return join(dirname(reportFile), 'deliverables');
}

export function deliverablesOutboxOf(outboxDir: string, stepId: string): string {
  return join(outboxDir, `step-${stepId}.deliverables`);
}

type DirectoryId = { dev: number; ino: number } | 'missing' | 'unsafe';

function directoryId(path: string): DirectoryId {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unsafe';
  }
  try {
    const st = fstatSync(fd);
    return { dev: st.dev, ino: st.ino };
  } finally {
    closeSync(fd);
  }
}

function sameDirectory(path: string, id: { dev: number; ino: number }): boolean {
  try {
    const st = lstatSync(path);
    return st.isDirectory() && st.dev === id.dev && st.ino === id.ino;
  } catch {
    return false;
  }
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function nameProblem(name: string, exts: readonly string[], seen: Set<string>): string | null {
  if (name.length > DELIVERABLE_LIMITS.maxNameChars || UNSAFE_NAME.test(name)) {
    return 'invalid-name';
  }
  if (!exts.includes(extOf(name))) return 'unsupported-kind';
  const folded = name.toLowerCase();
  if (seen.has(folded)) return 'duplicate-name';
  seen.add(folded);
  return null;
}

interface ContentCheck {
  push(chunk: Buffer): void;
  valid(): boolean;
}

function contentCheck(ext: string): ContentCheck {
  if (ext === 'html') {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let ok = true;
    return {
      push(chunk) {
        if (!ok) return;
        try {
          decoder.decode(chunk, { stream: true });
        } catch {
          ok = false;
        }
      },
      valid() {
        if (!ok) return false;
        try {
          decoder.decode();
          return true;
        } catch {
          return false;
        }
      },
    };
  }
  const magic = ext === 'pdf' ? PDF_MAGIC : ZIP_MAGIC;
  let head = Buffer.alloc(0);
  return {
    push(chunk) {
      if (head.length < magic.length) {
        head = Buffer.concat([head, chunk.subarray(0, magic.length - head.length)]);
      }
    },
    valid: () => head.equals(magic),
  };
}

function copyChecked(
  source: string,
  target: string,
  capBytes: number,
  ext: string,
): { size: number; sha256: string } | string {
  let input: number;
  try {
    input = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ELOOP' ? 'not-regular-file' : 'unreadable';
  }
  try {
    const st = fstatSync(input);
    if (!st.isFile()) return 'not-regular-file';
    if (st.nlink !== 1) return 'hard-link';
    if (st.size > capBytes) return 'too-large';
    const output = openSync(target, 'wx', 0o600);
    const hash = createHash('sha256');
    const check = contentCheck(ext);
    const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
    let size = 0;
    let problem: string | null = null;
    try {
      for (;;) {
        const read = readSync(input, buffer, 0, COPY_CHUNK_BYTES, null);
        if (read === 0) break;
        size += read;
        if (size > capBytes) {
          problem = 'too-large';
          break;
        }
        const chunk = buffer.subarray(0, read);
        hash.update(chunk);
        check.push(chunk);
        writeSync(output, chunk);
      }
    } finally {
      closeSync(output);
    }
    if (problem === null && !check.valid()) problem = 'invalid-content';
    if (problem !== null) {
      rmSync(target, { force: true });
      return problem;
    }
    return { size, sha256: hash.digest('hex') };
  } finally {
    closeSync(input);
  }
}

function boundedSkips(skipped: DeliverableSkip[]): DeliverableSkip[] {
  return skipped.slice(0, DELIVERABLE_LIMITS.maxSkipped).map((s) => ({
    name: s.name.slice(0, DELIVERABLE_LIMITS.maxNameChars),
    reason: s.reason,
  }));
}

export function snapshotDeliverables(input: {
  sourceDir: string;
  outboxDir: string;
  stepId: string;
  capability: DeliverableCapability;
}): DeliverableSnapshot {
  const { generation, limits } = input.capability;
  const target = deliverablesOutboxOf(input.outboxDir, input.stepId);
  rmSync(target, { recursive: true, force: true });
  const rejected = (): DeliverableSnapshot => {
    rmSync(target, { recursive: true, force: true });
    return {
      generation,
      copyDir: target,
      files: [],
      skipped: [{ name: 'deliverables', reason: 'unsafe-folder' }],
    };
  };
  const root = directoryId(input.sourceDir);
  if (root === 'missing') return { generation, copyDir: target, files: [], skipped: [] };
  if (root === 'unsafe') return rejected();
  const levels = [{ path: input.sourceDir, id: root }];
  const skipped: DeliverableSkip[] = [];
  const known = new Set(KIND_FOLDERS.map((k) => k.folder));
  for (const name of readdirSync(input.sourceDir).sort()) {
    if (!known.has(name)) skipped.push({ name, reason: 'outside-kind-folder' });
  }
  const candidates: {
    kind: DeliverableKind;
    exts: readonly string[];
    name: string;
    path: string;
  }[] = [];
  for (const { kind, folder, exts } of KIND_FOLDERS) {
    const dir = join(input.sourceDir, folder);
    const id = directoryId(dir);
    if (id === 'missing') continue;
    if (id === 'unsafe') return rejected();
    levels.push({ path: dir, id });
    const names = readdirSync(dir).sort();
    if (names.length > MAX_FOLDER_ENTRIES)
      skipped.push({ name: folder, reason: 'too-many-entries' });
    for (const name of names.slice(0, MAX_FOLDER_ENTRIES)) {
      candidates.push({ kind, exts, name, path: join(dir, name) });
    }
  }
  ensurePrivateDir(target);
  const files: DeliverableFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const candidate of candidates) {
    const problem = nameProblem(candidate.name, candidate.exts, seen);
    if (problem !== null) {
      skipped.push({ name: candidate.name, reason: problem });
      continue;
    }
    if (files.length >= limits.maxFiles) {
      skipped.push({ name: candidate.name, reason: 'over-file-limit' });
      continue;
    }
    const ext = extOf(candidate.name);
    const perFile = candidate.kind === 'page' ? limits.maxPageBytes : limits.maxSlidesBytes;
    const remaining = limits.maxTotalBytes - totalBytes;
    const copyPath = join(target, `${files.length}.${ext}`);
    const copied = copyChecked(candidate.path, copyPath, Math.min(perFile, remaining), ext);
    if (typeof copied === 'string') {
      skipped.push({
        name: candidate.name,
        reason: copied === 'too-large' && remaining < perFile ? 'over-size-limit' : copied,
      });
      continue;
    }
    totalBytes += copied.size;
    files.push({ kind: candidate.kind, name: candidate.name, ...copied, path: copyPath });
  }
  if (!levels.every((level) => sameDirectory(level.path, level.id))) return rejected();
  return { generation, copyDir: target, files, skipped: boundedSkips(skipped) };
}

function retryable(err: unknown): boolean {
  return (
    err instanceof MachineApiError &&
    (err.status === 429 || (err.status === 409 && err.body.includes('busy')))
  );
}

export async function deliverableDoneFields(
  client: MachineApi,
  logger: DaemonLogger,
  stepId: string,
  snapshot: DeliverableSnapshot,
): Promise<DeliverableDoneFields | null> {
  const fields: DeliverableDoneFields = {
    generation: snapshot.generation,
    deliverables: snapshot.files.map(({ name, sha256 }) => ({ name, sha256 })),
    deliverablesSkipped: snapshot.skipped,
  };
  if (snapshot.files.length === 0) return fields;
  if (!ownsCopyDir(snapshot.copyDir, stepId)) {
    throw new DeliverableRejectedError('deliverable copies are outside the outbox');
  }
  const put = client.putDeliverable?.bind(client);
  if (put === undefined) return null;
  let granted: Awaited<ReturnType<MachineApi['uploadUrls']>>['deliverables'];
  try {
    granted = (
      await client.uploadUrls(stepId, [], {
        generation: snapshot.generation,
        entries: snapshot.files.map(({ kind, name, size, sha256 }) => ({
          kind,
          name,
          size,
          sha256,
        })),
      })
    ).deliverables;
  } catch (err) {
    if (err instanceof MachineApiError && err.status === 404) return null;
    throw err;
  }
  if (granted === undefined) return null;
  for (const file of snapshot.files) {
    const slot = granted.find((g) => g.name === file.name);
    if (slot === undefined) {
      throw new DeliverableRejectedError(`server granted no upload for ${file.name}`);
    }
    if (slot.received) continue;
    if (!new URL(slot.url, 'http://server.invalid').pathname.startsWith(UPLOAD_PATH_PREFIX)) {
      throw new DeliverableRejectedError(`unexpected upload url for ${file.name}`);
    }
    if (dirname(file.path) !== snapshot.copyDir || !COPY_NAME.test(basename(file.path))) {
      throw new DeliverableRejectedError(`deliverable copy outside the outbox: ${file.name}`);
    }
    const bytes = readFileSync(file.path);
    for (let attempt = 1; ; attempt++) {
      try {
        await put(slot.url, slot.headers, bytes);
        break;
      } catch (err) {
        if (attempt >= PUT_ATTEMPTS || !retryable(err)) throw err;
        logger.step(`deliverable ${file.name} upload deferred (${(err as Error).message})`);
        await new Promise((r) => setTimeout(r, PUT_BACKOFF_MS * attempt));
      }
    }
  }
  return fields;
}
