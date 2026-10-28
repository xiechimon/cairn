import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import type { DeliveredImage, MachineAttachmentResponse } from '@cairn/shared';
import {
  ATTACHMENT_TOKEN_LINE,
  isImageAttachmentExt,
  issueFenceQuotedLines,
  parseAttachmentTokenLines,
  quoteIssueLines,
} from '@cairn/shared';

const FORMAT_CHAR = /^\p{Cf}$/u;

function safeFileName(fileName: string): string {
  const base = basename(fileName.replaceAll('\\', '/'));
  let out = '';
  for (const ch of base) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x85 || cp === 0x2028 || cp === 0x2029) continue;
    if (FORMAT_CHAR.test(ch)) continue;
    out += ch;
  }
  return out === '' || out === '.' || out === '..' ? 'attachment' : out;
}

const MATERIALIZE_EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/vnd.microsoft.icon': 'ico',
  'image/x-icon': 'ico',
  'image/avif': 'avif',
};

function inlineMime(mimeType: string): string | null {
  if (mimeType === 'image/jpg') return 'image/jpeg';
  switch (mimeType) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/gif':
    case 'image/webp':
      return mimeType;
    default:
      return null;
  }
}

export function materializeFile(
  materializeDir: string,
  stepId: string,
  fileName: string,
  bytes: Buffer,
): string {
  const path = join(materializeDir, stepId, safeFileName(fileName));
  const segments = relative(materializeDir, path).split(sep);
  if (segments.length !== 2 || segments.includes('..')) {
    throw new Error(
      `materialize path outside ${materializeDir}/<stepId>/: ${JSON.stringify(path)}`,
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}

export const STEP_ATTACHMENTS_TTL_MS = 72 * 60 * 60 * 1000;

export function sweepStepAttachments(
  materializeDir: string,
  opts?: { ttlMs?: number; now?: number },
): string[] {
  if (!existsSync(materializeDir)) return [];
  const ttlMs = opts?.ttlMs ?? STEP_ATTACHMENTS_TTL_MS;
  const now = opts?.now ?? Date.now();
  const removed: string[] = [];
  for (const entry of readdirSync(materializeDir)) {
    const full = join(materializeDir, entry);
    let mtimeMs: number | undefined;
    try {
      const st = statSync(full);
      if (st.isDirectory()) mtimeMs = st.mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs === undefined || now - mtimeMs < ttlMs) continue;
    rmSync(full, { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}

export interface AttachmentDownloader {
  attachment(
    stepId: string,
    attachmentId: string,
    teamId: string,
  ): Promise<MachineAttachmentResponse>;
}

export interface ResolveStepImagesOpts {
  text: string;
  stepId: string;
  client: AttachmentDownloader;
  materializeDir: string;
  log: (line: string) => void;
  imageSupport?: boolean | null;
}

export interface ResolvedStepImages {
  text: string;
  images: DeliveredImage[];
  skippedNoVision: number;
}

type Outcome =
  | { kind: 'inline'; anchor: string; image: DeliveredImage }
  | { kind: 'materialized'; note: string }
  | { kind: 'unavailable'; note: string }
  | { kind: 'noVision'; note: string }
  | { kind: 'untouched' };

interface TokenLine {
  quoted: boolean;
  body: string;
}

function tokenLinesOf(lines: readonly string[]): (TokenLine | null)[] {
  const quoted = issueFenceQuotedLines(lines);
  return lines.map((line, i) => {
    if (ATTACHMENT_TOKEN_LINE.test(line)) return { quoted: false, body: line };
    const body = quoted[i] ?? null;
    return body !== null && ATTACHMENT_TOKEN_LINE.test(body) ? { quoted: true, body } : null;
  });
}

export async function resolveStepImages(opts: ResolveStepImagesOpts): Promise<ResolvedStepImages> {
  const lines = opts.text.split('\n');
  const tokens = tokenLinesOf(lines);
  const bodies = tokens.flatMap((t) => (t === null ? [] : [t.body]));
  const images: DeliveredImage[] = [];
  if (bodies.length === 0) return { text: opts.text, images, skippedNoVision: 0 };
  const refs = parseAttachmentTokenLines(bodies.join('\n'));
  const outcomes = new Map<string, Outcome>();
  let skippedNoVision = 0;
  for (const ref of refs) {
    let outcome: Outcome;
    if (opts.imageSupport === false && isImageAttachmentExt(ref.ext)) {
      opts.log(`attachment not delivered (model does not support images): ${ref.key}`);
      outcome = { kind: 'noVision', note: `[图片附件 ${ref.key} 未被模型读取 — 该图片未下载]` };
    } else {
      outcome = await resolveOne(ref, opts);
    }
    if (outcome.kind === 'noVision') skippedNoVision += 1;
    outcomes.set(ref.line, outcome);
    if (outcome.kind === 'inline') images.push(outcome.image);
  }
  const outLines: string[] = [];
  for (const [i, line] of lines.entries()) {
    const token = tokens[i] ?? null;
    if (token === null) {
      outLines.push(line);
      continue;
    }
    const emit = (text: string): void => {
      outLines.push(token.quoted ? quoteIssueLines(text) : text);
    };
    const outcome = outcomes.get(token.body);
    if (outcome === undefined) {
      outLines.push(line);
      emit('[图片附件形态不合法（key 语法外）——该图片未交付]');
      opts.log(`attachment token rejected (key grammar): ${line}`);
      continue;
    }
    if (outcome.kind === 'inline') {
      emit(outcome.anchor);
    } else if (outcome.kind === 'untouched') {
      outLines.push(line);
    } else if (outcome.kind === 'materialized') {
      emit(outcome.note);
    } else {
      outLines.push(line);
      emit(outcome.note);
    }
  }
  return { text: outLines.join('\n'), images, skippedNoVision };
}

function unavailable(
  key: string,
  stage: 'download' | 'materialize',
  err: unknown,
  log: (line: string) => void,
): Outcome {
  const reason = err instanceof Error ? err.message : String(err);
  log(`attachment ${stage} failed: ${key} — ${reason}`);
  return { kind: 'unavailable', note: `[图片附件 ${key} 不可用：${reason} — 该图片未交付]` };
}

async function resolveOne(
  ref: { line: string; label: string; key: string; attachmentId: string; ext: string },
  opts: ResolveStepImagesOpts,
): Promise<Outcome> {
  if (!isImageAttachmentExt(ref.ext)) return { kind: 'untouched' };
  let res: MachineAttachmentResponse;
  try {
    res = await opts.client.attachment(opts.stepId, ref.attachmentId, ref.key.split('/')[0] ?? '');
  } catch (err) {
    return unavailable(ref.key, 'download', err, opts.log);
  }
  const mime = inlineMime(res.mimeType);
  if (mime !== null) {
    return {
      kind: 'inline',
      anchor: `[image attached: ${res.fileName}]`,
      image: { data: res.contentBase64, mimeType: mime },
    };
  }
  const bytes = Buffer.from(res.contentBase64, 'base64');
  let path: string;
  try {
    path = materializeFile(
      opts.materializeDir,
      opts.stepId,
      withMimeExt(res.fileName, res.mimeType),
      bytes,
    );
  } catch (err) {
    return unavailable(ref.key, 'materialize', err, opts.log);
  }
  opts.log(
    `attachment materialized: ${res.fileName} → ${path} (${res.mimeType} 不支持内联交付，走 Read 路线)`,
  );
  return {
    kind: 'materialized',
    note: `[图片附件 ${res.fileName}（${res.mimeType} 不支持内联交付）——用 Read 工具读取以下路径查看图片：${path}]`,
  };
}

function withMimeExt(fileName: string, mimeType: string): string {
  const wantExt = MATERIALIZE_EXT_BY_MIME[mimeType];
  if (wantExt === undefined) return fileName;
  const base = safeFileName(fileName);
  const lastDot = base.lastIndexOf('.');
  const stem = lastDot > 0 ? base.slice(0, lastDot) : base;
  return `${stem}.${wantExt}`;
}
