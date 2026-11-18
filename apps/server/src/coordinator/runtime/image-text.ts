import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ImageContent, Message } from '@earendil-works/pi-ai';
import type { Models } from '@earendil-works/pi-ai/models';

const execFileAsync = promisify(execFile);

const CAPTION_TIMEOUT_MS = 45_000;
const CAPTION_MAX_TOKENS = 1200;
const CAPTION_CANDIDATE_LIMIT = 3;
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

export const ATTACHMENT_CAPTION_ASK =
  'Transcribe all visible text verbatim, then briefly describe the image for an agent that cannot see it.';

export interface AttachmentImageInput {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  content: string;
}

export type OcrRunner = (image: AttachmentImageInput) => Promise<string | undefined>;

export interface AttachmentImageTextDeps {
  models: Pick<Models, 'getModels' | 'completeSimple'>;
  image: AttachmentImageInput;
  prepareImage: (data: string, mimeType: string) => Promise<ImageContent>;
  preferProvider?: string;
  ocr?: OcrRunner;
  signal?: AbortSignal;
}

function attachmentLabel(image: AttachmentImageInput): string {
  const size = image.sizeBytes === undefined ? '' : `, ${image.sizeBytes} bytes`;
  return `Attachment ${image.fileName} (${image.mimeType}${size})`;
}

async function visionCaption(
  deps: AttachmentImageTextDeps,
): Promise<{ text: string; by: string } | undefined> {
  const candidates = deps.models
    .getModels()
    .filter((model) => model.input.includes('image'))
    .sort(
      (a, b) =>
        Number(b.provider === deps.preferProvider) - Number(a.provider === deps.preferProvider) ||
        a.cost.input - b.cost.input ||
        a.id.localeCompare(b.id),
    )
    .slice(0, CAPTION_CANDIDATE_LIMIT);
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
          maxTokens: CAPTION_MAX_TOKENS,
          timeoutMs: CAPTION_TIMEOUT_MS,
          signal: deps.signal,
        },
      );
      const text = reply.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
      if (reply.stopReason === 'stop' && text !== '') {
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

export async function attachmentImageText(deps: AttachmentImageTextDeps): Promise<string> {
  const label = attachmentLabel(deps.image);
  const caption = await visionCaption(deps);
  if (caption !== undefined) {
    return `${label} — described by ${caption.by} because this model cannot see images:\n\n${caption.text}`;
  }
  const ocrText = await runOcr(deps);
  if (ocrText !== undefined && ocrText.trim() !== '') {
    return `${label} — OCR transcript (tesseract; this model cannot see images and no vision-capable model is configured). Raw OCR may lose layout and non-text content:\n\n${ocrText.trim()}`;
  }
  if (ocrText !== undefined) {
    return `${label} — OCR (tesseract) found no text. This model cannot see images and no vision-capable model is configured; ask the owner to describe it via ask_user if its content matters.`;
  }
  return `${label} is an image; this model cannot see images, and neither a vision-capable model nor tesseract OCR is available to read it. Ask the owner for a text description via ask_user.`;
}
