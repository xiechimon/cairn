import { z } from 'zod';
import { attachmentExtOf } from '../attachment-types.js';

export const ARTIFACT_KINDS = [
  'document',
  'page',
  'design',
  'diagram',
  'whiteboard',
  'code',
  'sheet',
  'pdf',
  'docx',
  'image',
  'video',
  'other',
] as const;
export const artifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

const KIND_BY_EXT: Readonly<Record<string, ArtifactKind>> = {
  md: 'document',
  markdown: 'document',
  html: 'page',
  htm: 'page',
  svg: 'design',
  mmd: 'diagram',
  mermaid: 'diagram',
  excalidraw: 'whiteboard',
  csv: 'sheet',
  tsv: 'sheet',
  pdf: 'pdf',
  docx: 'docx',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
};

const CODE_EXTS = new Set([
  'py',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'go',
  'rs',
  'rb',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'sh',
  'bash',
  'zsh',
  'sql',
  'css',
  'scss',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'txt',
  'log',
  'diff',
  'patch',
]);

export function artifactKindOf(fileName: string): ArtifactKind {
  const ext = attachmentExtOf(fileName);
  return KIND_BY_EXT[ext] ?? (CODE_EXTS.has(ext) ? 'code' : 'other');
}

export function isArtifactName(fileName: string): boolean {
  return artifactKindOf(fileName) !== 'other';
}

const unit = z.number().finite().min(0).max(1);
export const artifactRectSchema = z.object({ x: unit, y: unit, width: unit, height: unit });
export type ArtifactRect = z.infer<typeof artifactRectSchema>;

export const artifactAnchorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('region'),
    page: z.number().int().min(1).optional(),
    rect: artifactRectSchema,
  }),
  z.object({
    type: z.literal('lines'),
    from: z.number().int().min(1),
    to: z.number().int().min(1),
  }),
  z.object({
    type: z.literal('cells'),
    r1: z.number().int().min(0),
    c1: z.number().int().min(0),
    r2: z.number().int().min(0),
    c2: z.number().int().min(0),
  }),
  z.object({ type: z.literal('time'), seconds: z.number().finite().min(0) }),
  z.object({
    type: z.literal('shapes'),
    ids: z.array(z.string().min(1).max(200)).min(1).max(50),
  }),
  z.object({ type: z.literal('slide'), slide: z.number().int().min(1) }),
]);
export type ArtifactAnchor = z.infer<typeof artifactAnchorSchema>;
export type ArtifactAnchorType = ArtifactAnchor['type'];

const ANCHORS_BY_KIND: Readonly<Record<ArtifactKind, readonly ArtifactAnchorType[]>> = {
  document: [],
  page: ['slide'],
  design: ['region'],
  diagram: ['region'],
  whiteboard: ['shapes', 'region'],
  code: ['lines'],
  sheet: ['cells'],
  pdf: ['region'],
  docx: ['region'],
  image: ['region'],
  video: ['time', 'region'],
  other: [],
};

const ELEMENT_KINDS: ReadonlySet<ArtifactKind> = new Set(['document', 'page', 'design', 'diagram']);

export function anchorFitsKind(kind: ArtifactKind, anchor: ArtifactAnchor | null): boolean {
  if (anchor === null) return ELEMENT_KINDS.has(kind);
  return ANCHORS_BY_KIND[kind].includes(anchor.type);
}

export function describeAnchor(anchor: ArtifactAnchor): string {
  switch (anchor.type) {
    case 'region':
      return anchor.page === undefined ? '选区' : `第 ${anchor.page} 页的选区`;
    case 'lines':
      return anchor.from === anchor.to
        ? `第 ${anchor.from} 行`
        : `第 ${anchor.from}–${anchor.to} 行`;
    case 'cells': {
      const a = `${columnName(anchor.c1)}${anchor.r1 + 1}`;
      const b = `${columnName(anchor.c2)}${anchor.r2 + 1}`;
      return a === b ? a : `${a}:${b}`;
    }
    case 'time':
      return formatSeconds(anchor.seconds);
    case 'shapes':
      return `白板上的 ${anchor.ids.length} 个图形`;
    case 'slide':
      return `第 ${anchor.slide} 页幻灯片`;
  }
}

export function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function formatSeconds(total: number): string {
  const s = Math.floor(total);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type ArtifactCommentState = 'pending' | 'working' | 'done' | 'stale';

export function artifactCommentState(input: {
  status: 'open' | 'sent' | 'resolved';
  handledSeq: number | null;
  anchorResolves: boolean;
}): ArtifactCommentState {
  if (input.status === 'open') return 'pending';
  if (input.status === 'resolved') return 'done';
  if (input.handledSeq === null) return 'working';
  return input.anchorResolves ? 'done' : 'stale';
}

export const artifactOfAttachmentSchema = z.object({
  todoId: z.string(),
  fileName: z.string(),
  kind: artifactKindSchema,
  versionId: z.string(),
  versionSeq: z.number().int().min(1),
  versionCount: z.number().int().min(1),
  openComments: z.number().int().min(0),
});
export type ArtifactOfAttachment = z.infer<typeof artifactOfAttachmentSchema>;

export const artifactUserVersionSchema = z.object({
  content: z.string().min(1),
});

export function isExcalidrawScene(text: string): boolean {
  try {
    const scene = JSON.parse(text) as unknown;
    return (
      typeof scene === 'object' &&
      scene !== null &&
      (scene as { type?: unknown }).type === 'excalidraw' &&
      Array.isArray((scene as { elements?: unknown }).elements)
    );
  } catch {
    return false;
  }
}
