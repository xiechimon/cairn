import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import {
  attachmentExtOf,
  COMPUTER_IMAGE_MAX_BASE64_CHARS,
  type ComputerRelayResult,
  computerToolSchema,
  DELIVERABLE_LIMITS,
  type DeliverableKind,
  INFO_REPO_DIR,
  INFO_REPORT_MAX_BYTES,
  INFO_SUBMIT_REPORT_TOOL,
  INLINE_IMAGE_EXTS,
  INLINE_IMAGE_MIME_BY_EXT,
  infoTaskDir,
  inlineImageMimeOfBytes,
  isComputerBrowserTool,
  isInfoCardComputerTool,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import type { step, todo } from '../db/schema.js';
import { build, machine } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { publishBuild } from './builds.js';
import { infoCardTodoOf } from './computer-thread.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { infoComputerHosts } from './info-card.js';
import { storeInfoReport } from './info-handoff.js';
import { infoRepoOffered, infoRepoSnapshot } from './info-repo-snapshot.js';
import { COMPUTER_BUSY, COMPUTER_USER_CONTROL, forwardComputerCall } from './machine-computer.js';
import { replaceVmDeliverables, type VmDeliverableFile } from './machine-deliverables.js';
import { type MachineDeps, withFencedTransaction } from './machine-deps.js';

type StepRow = typeof step.$inferSelect;

export const INFO_OWNER_USING_COMPUTER =
  '主人正在使用电脑。先做不需要浏览器的工作，稍后再试这个浏览器调用。';
const BUSY_RETRY_MS = 2_000;
const BUSY_RETRY_LIMIT_MS = 3 * 60_000;
const REPORT_CHUNK_BYTES = 40 * 1024;
const SNAPSHOT_CHUNK_CHARS = 192 * 1024;
const APPEND_MAX_CHARS = 48_000;

const ensuredByDb = new WeakMap<Db, Set<string>>();

function ensuredOf(db: Db): Set<string> {
  let set = ensuredByDb.get(db);
  if (set === undefined) {
    set = new Set<string>();
    ensuredByDb.set(db, set);
  }
  return set;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function computerCall(
  deps: MachineDeps,
  machineId: string | null,
  row: StepRow,
  name: string,
  params: Record<string, unknown>,
  toolCallId: string,
  signal: AbortSignal | undefined,
): Promise<ComputerRelayResult> {
  const startedAt = Date.now();
  for (;;) {
    try {
      return await forwardComputerCall(
        deps,
        machineId,
        row.id,
        { computer: true, name: computerToolSchema.parse(name), toolCallId, params },
        signal === undefined ? {} : { signal },
      );
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409) throw error;
      if (error.message === COMPUTER_USER_CONTROL) {
        return { text: INFO_OWNER_USING_COMPUTER };
      }
      if (
        error.message !== COMPUTER_BUSY ||
        signal?.aborted === true ||
        Date.now() - startedAt > BUSY_RETRY_LIMIT_MS
      )
        throw error;
      await pause(BUSY_RETRY_MS, signal);
    }
  }
}

async function ensureTaskDir(
  deps: MachineDeps,
  machineId: string | null,
  row: StepRow,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (ensuredOf(deps.db).has(row.id)) return;
  const dir = infoTaskDir(row.buildId);
  const made = await computerCall(
    deps,
    machineId,
    row,
    'shell',
    { command: `mkdir -p ${shellQuote(dir)}` },
    `${row.id}-task-dir`,
    signal,
  );
  if (made.text.includes('computer error:')) throw new HttpError(409, made.text);
  await seedRepoSnapshot(deps, machineId, row, signal);
  ensuredOf(deps.db).add(row.id);
}

async function seedRepoSnapshot(
  deps: MachineDeps,
  machineId: string | null,
  row: StepRow,
  signal: AbortSignal | undefined,
): Promise<void> {
  const todoRow = infoCardTodoOf(deps.db, row);
  if (todoRow === null || !infoRepoOffered(deps, todoRow)) return;
  const dir = infoTaskDir(row.buildId);
  const failed = (reason: string) =>
    computerCall(
      deps,
      machineId,
      row,
      'write_file',
      {
        path: `${dir}/repo-snapshot-failed.txt`,
        content: `The repository snapshot is unavailable: ${reason}\n`,
      },
      `${row.id}-repo-failed`,
      signal,
    );
  let snapshot: Awaited<ReturnType<typeof infoRepoSnapshot>>;
  try {
    snapshot = await infoRepoSnapshot(deps, todoRow, row, signal);
  } catch (error) {
    await failed(error instanceof Error ? error.message : String(error));
    return;
  }
  if (snapshot === null) return;
  if ('reason' in snapshot) {
    await failed(snapshot.reason);
    return;
  }
  const encoded = snapshot.tarGz.toString('base64');
  const parts: string[] = [];
  for (let at = 0, index = 0; at < encoded.length; at += SNAPSHOT_CHUNK_CHARS, index++) {
    const path = `${dir}/.repo-${index}.b64`;
    const wrote = await computerCall(
      deps,
      machineId,
      row,
      'write_file',
      { path, content: encoded.slice(at, at + SNAPSHOT_CHUNK_CHARS) },
      `${row.id}-repo-part-${index}`,
      signal,
    );
    if (wrote.text.includes('computer error:')) {
      await failed(wrote.text);
      return;
    }
    parts.push(shellQuote(path));
  }
  const strip =
    githubRepoOfProject(projectOfTodo(deps.db, todoRow)) === null ? '' : ' --strip-components=1';
  const unpacked = await computerCall(
    deps,
    machineId,
    row,
    'shell',
    {
      command: `mkdir -p ${shellQuote(`${dir}/${INFO_REPO_DIR}`)} && cat ${parts.join(' ')} | base64 -d | tar xz${strip} -C ${shellQuote(`${dir}/${INFO_REPO_DIR}`)} && rm -f ${parts.join(' ')} && chmod -R a-w ${shellQuote(`${dir}/${INFO_REPO_DIR}`)}`,
    },
    `${row.id}-repo-unpack`,
    signal,
  );
  if (unpacked.text.includes('[exit code') || unpacked.text.includes('computer error:')) {
    await failed(unpacked.text.slice(0, 300));
  }
}

function reportPathOf(buildId: string, raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new HttpError(400, 'submit_report needs the path of your report file');
  }
  const dir = infoTaskDir(buildId);
  const path = posix.resolve(dir, raw.trim());
  if (!path.startsWith(`${dir}/`)) {
    throw new HttpError(400, `the report must be a file inside ${dir}/`);
  }
  return path;
}

export async function readComputerFile(
  deps: MachineDeps,
  machineId: string | null,
  row: StepRow,
  path: string,
  signal: AbortSignal | undefined,
  maxBytes: number = INFO_REPORT_MAX_BYTES,
): Promise<Buffer> {
  const quoted = shellQuote(path);
  const sized = await computerCall(
    deps,
    machineId,
    row,
    'shell',
    { command: `test -f ${quoted} && wc -c < ${quoted}` },
    randomUUID(),
    signal,
  );
  const size = Number(sized.text.trim());
  if (!Number.isInteger(size)) {
    throw new HttpError(400, `${path} does not exist or is not a file; write it first`);
  }
  if (size === 0) throw new HttpError(400, `${path} is empty; write the full report first`);
  if (size > maxBytes) {
    throw new HttpError(
      400,
      `${path} is ${size} bytes, over the ${maxBytes} byte limit; make it smaller and submit again`,
    );
  }
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < size; offset += REPORT_CHUNK_BYTES) {
    const read = await computerCall(
      deps,
      machineId,
      row,
      'shell',
      {
        command: `dd if=${quoted} bs=${REPORT_CHUNK_BYTES} skip=${offset / REPORT_CHUNK_BYTES} count=1 2>/dev/null | base64 -w0`,
      },
      randomUUID(),
      signal,
    );
    chunks.push(Buffer.from(read.text.trim(), 'base64'));
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== size) {
    throw new HttpError(409, `${path} could not be read back completely; submit it again`);
  }
  return bytes;
}

function persistInfoReport(
  deps: MachineDeps,
  row: StepRow,
  todoRow: typeof todo.$inferSelect,
  report: string,
): void {
  if (deps.attachmentsDir === undefined) throw new HttpError(500, 'attachments are not configured');
  withFencedTransaction(deps, (settled) => {
    settled.assertClaim?.();
    storeInfoReport(settled, {
      buildId: row.buildId,
      teamId: todoRow.teamId,
      createdBy: deps.user.id,
      report,
    });
  });
  const stored = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
  if (stored) publishBuild(deps, stored);
}

async function submitInfoReport(
  deps: MachineDeps,
  machineId: string | null,
  row: StepRow,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (row.status !== 'claimed') {
    throw new HttpError(409, 'submit_report requires a currently claimed step');
  }
  const todoRow = infoCardTodoOf(deps.db, row);
  if (todoRow === null) throw new HttpError(400, 'submit_report is only for info cards');
  const targetMachineId = machineId ?? row.machineId;
  const host =
    targetMachineId === null
      ? infoComputerHosts(deps.db, todoRow.teamId)[0]
      : deps.db.select().from(machine).where(eq(machine.id, targetMachineId)).get();
  if (host?.capabilities?.computer !== true) {
    if (typeof params.content !== 'string' || params.content.trim() === '') {
      throw new HttpError(400, 'submit_report needs the report markdown in content');
    }
    const byteLength = Buffer.byteLength(params.content, 'utf8');
    if (byteLength > INFO_REPORT_MAX_BYTES) {
      throw new HttpError(
        400,
        `report is ${byteLength} bytes, over the ${INFO_REPORT_MAX_BYTES} byte limit; make it smaller and submit again`,
      );
    }
    persistInfoReport(deps, row, todoRow, params.content);
    return `report accepted (${byteLength} bytes). Give a short final reply and end your turn.`;
  }
  const path = reportPathOf(row.buildId, params.path);
  const bytes = await readComputerFile(deps, machineId, row, path, signal);
  const report = bytes.toString('utf8');
  if (report.trim() === '') throw new HttpError(400, `${path} has no text; write the report first`);
  persistInfoReport(deps, row, todoRow, report);
  const deliverables = await collectDeliverables(deps, machineId, row, todoRow, signal);
  return `report accepted (${bytes.length} bytes).${deliverables} Give a short final reply and end your turn.`;
}

const DELIVERABLE_FOLDERS: { folder: string; kind: DeliverableKind }[] = [
  { folder: 'pages', kind: 'page' },
  { folder: 'slides', kind: 'slides' },
  { folder: 'images', kind: 'image' },
];
const DELIVERABLE_MAX_BYTES: Record<DeliverableKind, number> = {
  page: DELIVERABLE_LIMITS.maxPageBytes,
  slides: DELIVERABLE_LIMITS.maxSlidesBytes,
  image: DELIVERABLE_LIMITS.maxImageBytes,
};
const COMPUTER_IMAGE_MAX_BYTES = Math.floor((COMPUTER_IMAGE_MAX_BASE64_CHARS * 3) / 4);

async function collectDeliverables(
  deps: MachineDeps,
  machineId: string | null,
  row: StepRow,
  todoRow: typeof todo.$inferSelect,
  signal: AbortSignal | undefined,
): Promise<string> {
  const dir = `${infoTaskDir(row.buildId)}/deliverables`;
  const listed = await computerCall(
    deps,
    machineId,
    row,
    'shell',
    {
      command: `cd ${shellQuote(dir)} 2>/dev/null && for f in pages/* slides/* images/* *.png *.PNG *.jpg *.JPG *.jpeg *.JPEG *.gif *.GIF *.webp *.WEBP; do [ -f "$f" ] && printf '%s\\t%s\\n' "$f" "$(wc -c < "$f")"; done; true`,
    },
    randomUUID(),
    signal,
  );
  const entries = listed.text.split('\n').flatMap((line) => {
    const [path, size] = line.split('\t');
    if (!path) return [];
    if (!path.includes('/')) {
      const ext = attachmentExtOf(path);
      return (INLINE_IMAGE_EXTS as readonly string[]).includes(ext)
        ? [{ path, name: path, kind: 'image' as const, size: Number(size) }]
        : [];
    }
    const folder = DELIVERABLE_FOLDERS.find((f) => path.startsWith(`${f.folder}/`));
    const name = folder === undefined ? undefined : path.slice(folder.folder.length + 1);
    return folder === undefined || name === undefined || name === '' || name.includes('/')
      ? []
      : [{ path, name, kind: folder.kind, size: Number(size) }];
  });
  if (entries.length === 0) {
    deps.assertClaim?.();
    replaceVmDeliverables(deps, row, todoRow, []);
    return '';
  }
  const files: VmDeliverableFile[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const entry of entries) {
    const limit = DELIVERABLE_MAX_BYTES[entry.kind];
    if (!Number.isInteger(entry.size) || entry.size > limit) {
      skipped.push({ name: entry.name, reason: 'too-large' });
      continue;
    }
    try {
      files.push({
        name: entry.name,
        kind: entry.kind,
        bytes: await readComputerFile(deps, machineId, row, `${dir}/${entry.path}`, signal, limit),
      });
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      skipped.push({ name: entry.name, reason: error.message.slice(0, 120) });
    }
  }
  deps.assertClaim?.();
  const stored = replaceVmDeliverables(deps, row, todoRow, files);
  const all = [...skipped, ...stored.skipped];
  return ` ${files.length - stored.skipped.length} deliverable file(s) kept.${
    all.length === 0 ? '' : ` Skipped: ${all.map((s) => `${s.name} (${s.reason})`).join(', ')}.`
  }`;
}

async function appendFile(
  deps: MachineDeps,
  machineId: string | null,
  row: StepRow,
  params: Record<string, unknown>,
  toolCallId: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (typeof params.path !== 'string' || params.path.trim() === '') {
    throw new HttpError(400, 'write_file needs a path');
  }
  if (typeof params.content !== 'string') throw new HttpError(400, 'write_file needs content');
  if (params.content.length > APPEND_MAX_CHARS) {
    throw new HttpError(
      400,
      `append is limited to ${APPEND_MAX_CHARS} characters per call; split the content into smaller parts`,
    );
  }
  const path = posix.resolve(infoTaskDir(row.buildId), params.path.trim());
  const encoded = Buffer.from(params.content, 'utf8').toString('base64');
  const result = await computerCall(
    deps,
    machineId,
    row,
    'shell',
    {
      command: `mkdir -p ${shellQuote(posix.dirname(path))} && printf %s ${shellQuote(encoded)} | base64 -d >> ${shellQuote(path)}`,
      cwd: infoTaskDir(row.buildId),
    },
    toolCallId,
    signal,
  );
  if (result.text.includes('[exit code') || result.text.includes('computer error:')) {
    throw new HttpError(409, result.text);
  }
  return `appended ${Buffer.byteLength(params.content)} bytes to ${path}`;
}

export async function executeInfoCardTool(
  deps: MachineDeps,
  machineId: string | null,
  row: StepRow,
  name: string,
  params: Record<string, unknown>,
  toolCallId: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (name === INFO_SUBMIT_REPORT_TOOL) {
    return submitInfoReport(deps, machineId, row, params, signal);
  }
  if (
    !isInfoCardComputerTool(name) &&
    !isComputerBrowserTool(name) &&
    name !== 'request_takeover'
  ) {
    throw new HttpError(400, `${name} is not an info card tool`);
  }
  await ensureTaskDir(deps, machineId, row, signal);
  if (name === 'write_file' && params.append === true) {
    return appendFile(deps, machineId, row, params, toolCallId ?? randomUUID(), signal);
  }
  if (name === 'read_file' && typeof params.path === 'string' && params.path.trim() !== '') {
    const ext = attachmentExtOf(params.path.trim());
    const expectedMime = INLINE_IMAGE_MIME_BY_EXT[ext];
    if (expectedMime !== undefined) {
      const path = posix.resolve(infoTaskDir(row.buildId), params.path.trim());
      const bytes = await readComputerFile(
        deps,
        machineId,
        row,
        path,
        signal,
        COMPUTER_IMAGE_MAX_BYTES,
      );
      if (inlineImageMimeOfBytes(bytes) !== expectedMime) {
        throw new HttpError(400, `${path} does not match a valid .${ext} image`);
      }
      return JSON.stringify({
        fileName: posix.basename(path),
        mimeType: expectedMime,
        sizeBytes: bytes.length,
        encoding: 'base64',
        content: bytes.toString('base64'),
      });
    }
  }
  const withCwd =
    name === 'shell' && typeof params.cwd !== 'string'
      ? { ...params, cwd: infoTaskDir(row.buildId) }
      : params;
  const result = await computerCall(
    deps,
    machineId,
    row,
    name,
    withCwd,
    toolCallId ?? randomUUID(),
    signal,
  );
  return result.text;
}
