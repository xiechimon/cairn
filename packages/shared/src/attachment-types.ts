export type AttachmentKind = 'image' | 'pdf' | 'text' | 'download';

interface AttachmentTypeEntry {
  kind: AttachmentKind;
  mime: string;
  extraMimes?: readonly string[];
  inline?: boolean;
}

const OFFICE_FALLBACK = ['application/octet-stream'] as const;

const ATTACHMENT_TYPES: Readonly<Record<string, AttachmentTypeEntry>> = {
  md: { kind: 'text', mime: 'text/markdown', extraMimes: ['text/x-markdown'] },
  markdown: { kind: 'text', mime: 'text/markdown', extraMimes: ['text/x-markdown'] },
  txt: { kind: 'text', mime: 'text/plain' },
  rst: { kind: 'text', mime: 'text/plain' },
  adoc: { kind: 'text', mime: 'text/plain' },
  log: { kind: 'text', mime: 'text/plain' },
  diff: { kind: 'text', mime: 'text/plain' },
  patch: { kind: 'text', mime: 'text/plain' },
  json: { kind: 'text', mime: 'application/json', extraMimes: ['text/json'] },
  yaml: {
    kind: 'text',
    mime: 'text/plain',
    extraMimes: ['application/yaml', 'application/x-yaml'],
  },
  yml: { kind: 'text', mime: 'text/plain', extraMimes: ['application/yaml', 'application/x-yaml'] },
  toml: { kind: 'text', mime: 'text/plain', extraMimes: ['application/toml'] },
  xml: { kind: 'text', mime: 'application/xml', extraMimes: ['text/xml'] },
  csv: {
    kind: 'text',
    mime: 'text/csv',
    extraMimes: ['application/csv', 'application/vnd.ms-excel'],
  },
  tsv: { kind: 'text', mime: 'text/tab-separated-values' },
  html: { kind: 'text', mime: 'text/html' },
  htm: { kind: 'text', mime: 'text/html' },
  css: { kind: 'text', mime: 'text/css' },
  scss: { kind: 'text', mime: 'text/plain' },
  less: { kind: 'text', mime: 'text/plain' },
  js: { kind: 'text', mime: 'text/javascript' },
  jsx: { kind: 'text', mime: 'text/plain' },
  ts: { kind: 'text', mime: 'text/plain', extraMimes: ['video/mp2t'] },
  tsx: { kind: 'text', mime: 'text/plain' },
  mjs: { kind: 'text', mime: 'text/javascript' },
  cjs: { kind: 'text', mime: 'text/javascript' },
  py: { kind: 'text', mime: 'text/plain' },
  rb: { kind: 'text', mime: 'text/plain' },
  go: { kind: 'text', mime: 'text/plain' },
  rs: { kind: 'text', mime: 'text/plain' },
  java: { kind: 'text', mime: 'text/plain' },
  kt: { kind: 'text', mime: 'text/plain' },
  swift: { kind: 'text', mime: 'text/plain' },
  m: { kind: 'text', mime: 'text/plain' },
  mm: { kind: 'text', mime: 'text/plain' },
  c: { kind: 'text', mime: 'text/plain' },
  h: { kind: 'text', mime: 'text/plain' },
  cpp: { kind: 'text', mime: 'text/plain' },
  hpp: { kind: 'text', mime: 'text/plain' },
  cs: { kind: 'text', mime: 'text/plain' },
  sh: { kind: 'text', mime: 'text/plain', extraMimes: ['application/x-sh'] },
  bash: { kind: 'text', mime: 'text/plain' },
  zsh: { kind: 'text', mime: 'text/plain' },
  ps1: { kind: 'text', mime: 'text/plain' },
  sql: { kind: 'text', mime: 'text/plain', extraMimes: ['application/sql'] },
  graphql: { kind: 'text', mime: 'text/plain' },
  proto: { kind: 'text', mime: 'text/plain' },
  png: { kind: 'image', mime: 'image/png', inline: true },
  jpg: { kind: 'image', mime: 'image/jpeg', inline: true },
  jpeg: { kind: 'image', mime: 'image/jpeg', inline: true },
  gif: { kind: 'image', mime: 'image/gif', inline: true },
  webp: { kind: 'image', mime: 'image/webp', inline: true },
  svg: { kind: 'image', mime: 'image/svg+xml' },
  bmp: { kind: 'image', mime: 'image/bmp' },
  ico: { kind: 'image', mime: 'image/x-icon', extraMimes: ['image/vnd.microsoft.icon'] },
  avif: { kind: 'image', mime: 'image/avif' },
  pdf: { kind: 'pdf', mime: 'application/pdf', inline: true },
  xlsx: {
    kind: 'download',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extraMimes: OFFICE_FALLBACK,
  },
  xls: { kind: 'download', mime: 'application/vnd.ms-excel', extraMimes: OFFICE_FALLBACK },
  docx: {
    kind: 'download',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extraMimes: OFFICE_FALLBACK,
  },
  doc: { kind: 'download', mime: 'application/msword', extraMimes: OFFICE_FALLBACK },
  pptx: {
    kind: 'download',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extraMimes: OFFICE_FALLBACK,
  },
  ppt: { kind: 'download', mime: 'application/vnd.ms-powerpoint', extraMimes: OFFICE_FALLBACK },
  zip: {
    kind: 'download',
    mime: 'application/zip',
    extraMimes: ['application/x-zip-compressed', ...OFFICE_FALLBACK],
  },
};

const UNSAFE_DECLARED_TEXT = new Set([
  'text/html',
  'text/xml',
  'text/javascript',
  'text/xsl',
  'text/x-component',
]);

export const ATTACHMENT_FALLBACK_MIME = 'application/octet-stream';

export function attachmentExtOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot < 0 || lastDot === fileName.length - 1) return '';
  const ext = fileName.slice(lastDot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

export function isAllowedAttachmentExt(ext: string): boolean {
  return Object.hasOwn(ATTACHMENT_TYPES, ext);
}

export function attachmentKindOf(fileName: string): AttachmentKind | null {
  return ATTACHMENT_TYPES[attachmentExtOf(fileName)]?.kind ?? null;
}

export function resolveAttachmentMime(fileName: string, declaredMime: string): string | null {
  const ext = attachmentExtOf(fileName);
  const entry = isAllowedAttachmentExt(ext) ? ATTACHMENT_TYPES[ext] : undefined;
  if (entry === undefined) return null;
  const declared = declaredMime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (declared === entry.mime || entry.extraMimes?.includes(declared) === true) {
    return declared === ATTACHMENT_FALLBACK_MIME ? entry.mime : declared;
  }
  if (
    entry.kind === 'text' &&
    declared.startsWith('text/') &&
    !UNSAFE_DECLARED_TEXT.has(declared)
  ) {
    return declared;
  }
  return entry.mime;
}

export function servedAttachmentMime(storageKeyOrName: string): string {
  const entry = ATTACHMENT_TYPES[attachmentExtOf(storageKeyOrName)];
  return entry?.mime ?? ATTACHMENT_FALLBACK_MIME;
}

export function isInlineAttachment(storageKeyOrName: string, storedMime: string): boolean {
  const entry = ATTACHMENT_TYPES[attachmentExtOf(storageKeyOrName)];
  return entry?.inline === true && entry.mime === storedMime;
}

export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(',');
