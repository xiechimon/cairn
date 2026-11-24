import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  extractCaptionReplyText,
  IMAGE_CAPTION_ASK,
  IMAGE_CAPTION_MAX_TOKENS,
  IMAGE_CAPTION_TIMEOUT_MS,
  rankImageCaptionModels,
} from '@cairn/shared';
import type { ImageContent, Message } from '@earendil-works/pi-ai';
import type { Models } from '@earendil-works/pi-ai/models';

const execFileAsync = promisify(execFile);

const OCR_TIMEOUT_MS = 30_000;
const OCR_MAX_OUTPUT_BYTES = 512 * 1024;
const OCR_PREFERRED_LANGS = ['eng', 'chi_sim'];
const OCR_EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};

export const ATTACHMENT_CAPTION_ASK = IMAGE_CAPTION_ASK;

export interface AttachmentImageInput {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  content: string;
}

export type OcrRunner = (image: AttachmentImageInput) => Promise<string | undefined>;

export type ImageTextVia = 'caption' | 'ocr' | 'ocr-empty' | 'unreadable';

export interface AttachmentImageTextResult {
  text: string;
  via: ImageTextVia;
  attribution?: string;
}

export interface ImageTextCacheEntry {
  via: 'caption' | 'ocr';
  attribution?: string;
  tail: string;
}

export interface AttachmentImageTextDeps {
  models: Pick<Models, 'getModels' | 'completeSimple'>;
  image: AttachmentImageInput;
  prepareImage: (data: string, mimeType: string) => Promise<ImageContent>;
  preferProvider?: string;
  ocr?: OcrRunner;
  signal?: AbortSignal;
  cache?: Map<string, ImageTextCacheEntry>;
}

function attachmentLabel(image: AttachmentImageInput): string {
  const size = image.sizeBytes === undefined ? '' : `, ${image.sizeBytes} bytes`;
  return `Attachment ${image.fileName} (${image.mimeType}${size})`;
}

async function visionCaption(
  deps: AttachmentImageTextDeps,
): Promise<{ text: string; by: string } | undefined> {
  const candidates = rankImageCaptionModels(deps.models.getModels(), deps.preferProvider);
  if (candidates.length === 0) return undefined;
  let prepared: ImageContent;
  try {
    prepared = await deps.prepareImage(deps.image.content, deps.image.mimeType);
  } catch {
    return undefined;
  }
  const messages: Message[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: ATTACHMENT_CAPTION_ASK }, prepared],
      timestamp: Date.now(),
    },
  ];
  for (const model of candidates) {
    try {
      const reply = await deps.models.completeSimple(
        model,
        { messages },
        {
          toolChoice: 'none',
          maxTokens: IMAGE_CAPTION_MAX_TOKENS,
          timeoutMs: IMAGE_CAPTION_TIMEOUT_MS,
          signal: deps.signal,
        },
      );
      const text = extractCaptionReplyText(reply);
      if (text !== null) {
        return { text, by: `${model.provider}/${model.id}` };
      }
    } catch {}
  }
  return undefined;
}

export function tesseractOcrRunner(options: { bin?: string } = {}): OcrRunner {
  const bin = options.bin ?? 'tesseract';
  let langs: Promise<Set<string> | null> | undefined;
  const availableLangs = () => {
    langs ??= execFileAsync(bin, ['--list-langs'], { timeout: 10_000 }).then(
      ({ stdout }) =>
        new Set(
          stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => /^[a-z_]+$/i.test(line)),
        ),
      () => null,
    );
    return langs;
  };
  return async (image) => {
    const found = await availableLangs();
    if (found === null) return undefined;
    const use = OCR_PREFERRED_LANGS.filter((lang) => found.has(lang));
    const dir = mkdtempSync(join(tmpdir(), 'cairn-ocr-'));
    try {
      const file = join(dir, `image${OCR_EXT_BY_MIME[image.mimeType] ?? '.png'}`);
      writeFileSync(file, Buffer.from(image.content, 'base64'), { mode: 0o600 });
      const { stdout } = await execFileAsync(
        bin,
        [file, 'stdout', ...(use.length > 0 ? ['-l', use.join('+')] : [])],
        { timeout: OCR_TIMEOUT_MS, maxBuffer: OCR_MAX_OUTPUT_BYTES, killSignal: 'SIGKILL' },
      );
      return stdout;
    } catch {
      return undefined;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

let defaultOcr: OcrRunner | undefined;

async function runOcr(deps: AttachmentImageTextDeps): Promise<string | undefined> {
  let runner = deps.ocr;
  if (runner === undefined) {
    defaultOcr ??= tesseractOcrRunner();
    runner = defaultOcr;
  }
  try {
    return await runner(deps.image);
  } catch {
    return undefined;
  }
}

const IMAGE_TEXT_CACHE_LIMIT = 128;
const sharedImageTextCache = new Map<string, ImageTextCacheEntry>();

function imageTextCacheKey(image: AttachmentImageInput): string {
  return createHash('sha256').update(`${image.mimeType}\0${image.content}`).digest('hex');
}

function rememberImageText(
  cache: Map<string, ImageTextCacheEntry>,
  key: string,
  entry: ImageTextCacheEntry,
): void {
  cache.set(key, entry);
  const oldest = cache.size > IMAGE_TEXT_CACHE_LIMIT ? cache.keys().next().value : undefined;
  if (oldest !== undefined) cache.delete(oldest);
}

export async function attachmentImageText(
  deps: AttachmentImageTextDeps,
): Promise<AttachmentImageTextResult> {
  const label = attachmentLabel(deps.image);
  const cache = deps.cache ?? sharedImageTextCache;
  const key = imageTextCacheKey(deps.image);
  const hit = cache.get(key);
  if (hit !== undefined) {
    return { text: `${label} — ${hit.tail}`, via: hit.via, attribution: hit.attribution };
  }
  const caption = await visionCaption(deps);
  if (caption !== undefined) {
    const tail = `described by ${caption.by} because this model cannot see images:\n\n${caption.text}`;
    rememberImageText(cache, key, { via: 'caption', attribution: caption.by, tail });
    return { text: `${label} — ${tail}`, via: 'caption', attribution: caption.by };
  }
  const ocrText = await runOcr(deps);
  if (ocrText !== undefined && ocrText.trim() !== '') {
    const tail = `OCR transcript (tesseract; this model cannot see images and no vision-capable model is configured). Raw OCR may lose layout and non-text content:\n\n${ocrText.trim()}`;
    rememberImageText(cache, key, { via: 'ocr', tail });
    return { text: `${label} — ${tail}`, via: 'ocr' };
  }
  if (ocrText !== undefined) {
    return {
      text: `${label} — OCR (tesseract) found no text. This model cannot see images and no vision-capable model is configured; ask the owner to describe it via ask_user if its content matters.`,
      via: 'ocr-empty',
    };
  }
  return {
    text: `${label} is an image; this model cannot see images, and neither a vision-capable model nor tesseract OCR is available to read it. Ask the owner for a text description via ask_user.`,
    via: 'unreadable',
  };
}
