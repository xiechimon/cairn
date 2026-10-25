import { toast } from 'sonner';
import { AttachmentError, attachFile } from '../api/attachments.js';

export interface ClipboardFileItem {
  kind: string;
  getAsFile(): File | null;
}

export interface ClipboardDataLike {
  files?: ArrayLike<File>;
  items?: ArrayLike<ClipboardFileItem>;
}

export function filesFromClipboardData(data: ClipboardDataLike | null | undefined): File[] {
  if (data == null) return [];
  const direct = Array.from(data.files ?? []);
  if (direct.length > 0) return direct;
  const fromItems: File[] = [];
  const items = data.items ?? [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item != null && item.kind === 'file') {
      const file = item.getAsFile();
      if (file != null) fromItems.push(file);
    }
  }
  return fromItems;
}

export function insertAttachmentTokens(
  value: string,
  tokens: string[],
  caret: number | null,
): { value: string; caret: number } {
  const at = caret == null || caret < 0 || caret > value.length ? value.length : caret;
  if (tokens.length === 0) return { value, caret: at };
  const before = value.slice(0, at);
  const after = value.slice(at);
  const lead = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  const trail = after.startsWith('\n') ? '' : '\n';
  const block = tokens.join('\n');
  const nextCaret =
    before.length + lead.length + block.length + trail.length + (trail === '' ? 1 : 0);
  return { value: before + lead + block + trail + after, caret: nextCaret };
}

const GENERIC_IMAGE_NAME = /^image\.[a-z0-9]+$/i;

export const ATTACHMENT_LINE = /^ {0,3}!\[([^\]]*)\]\(attachment:([^)]+)\)\s*$/;

export interface AttachmentToken {
  name: string;
  key: string;
}

export function parseAttachmentTokens(text: string): AttachmentToken[] {
  const out: AttachmentToken[] = [];
  for (const line of text.split('\n')) {
    const hit = ATTACHMENT_LINE.exec(line);
    if (hit !== null) out.push({ name: hit[1] ?? '', key: hit[2] ?? '' });
  }
  return out;
}

export interface PendingAttachment {
  uid: string;
  name: string;
  mime: string;
  url: string | null;
}

export function isGenericClipboardName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === '') return true;
  if (trimmed.toLowerCase() === 'blob') return true;
  return GENERIC_IMAGE_NAME.test(trimmed);
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/avif': 'avif',
};

export function pastedImageExt(mime: string): string | null {
  const normalized = mime.trim().toLowerCase();
  const mapped = MIME_EXT[normalized];
  if (mapped !== undefined) return mapped;
  if (normalized.startsWith('image/')) {
    const sub = normalized.slice('image/'.length);
    if (/^[a-z0-9]{1,8}$/.test(sub)) return sub;
  }
  return null;
}

function extOfName(name: string): string | null {
  const lastDot = name.lastIndexOf('.');
  if (lastDot < 0 || lastDot === name.length - 1) return null;
  const ext = name.slice(lastDot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : null;
}

export interface PastedNameCounter {
  begin(draftBlank: boolean): void;
  end(): void;
  next(ext: string): string;
}

export function createPastedNameCounter(): PastedNameCounter {
  let count = 0;
  let inFlight = 0;
  return {
    begin(draftBlank: boolean) {
      if (draftBlank && inFlight === 0) count = 0;
      inFlight += 1;
    },
    end() {
      inFlight = Math.max(0, inFlight - 1);
    },
    next(ext: string) {
      count += 1;
      return `pasted-image-${count}.${ext}`;
    },
  };
}

export function preparePastedFiles(files: readonly File[], counter: PastedNameCounter): File[] {
  return files.map((file) => {
    if (!isGenericClipboardName(file.name)) return file;
    const ext = pastedImageExt(file.type) ?? extOfName(file.name);
    if (ext === null) return file;
    return new File([file], counter.next(ext), {
      type: file.type,
      lastModified: file.lastModified,
    });
  });
}

export function attachmentFailureTitle(err: unknown): string {
  if (err instanceof AttachmentError) {
    if (err.reason === 'size') return '附件超过 10MB 上限';
    if (err.reason === 'mime') return '不支持该文件类型';
  }
  return '附件上传失败';
}

export async function uploadMessageAttachments(
  files: File[],
  t: (key: string) => string,
): Promise<string[]> {
  const tokens: string[] = [];
  for (const file of files) {
    try {
      const r = await attachFile({ file, scope: 'message' });
      tokens.push(r.token);
    } catch (err) {
      console.error('attachment failed', file.name, err);
      toast.error(t(attachmentFailureTitle(err)), {
        description: file.name,
      });
    }
  }
  return tokens;
}
