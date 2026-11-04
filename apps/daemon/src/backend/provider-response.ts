import { parseRetryAfterMs } from '@cairn/shared';

export interface ProviderResponseShape {
  url: string;
  status: number;
  statusText: string;
  contentType: string | null;
  eventStream: boolean;
  retryAfterMs: number | null;
  preview: string | null;
}

export interface ProviderResponseSink {
  current: ProviderResponseShape | null;
}

export interface ProviderResponseContext {
  machineName?: string;
  providerBaseUrl?: string;
}

export const RESPONSE_PREVIEW_BYTES = 512;
export const RESPONSE_PREVIEW_CHARS = 200;

export function isEventStreamContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  return /^\s*text\/event-stream\b/i.test(contentType);
}

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  const url = (input as { url?: unknown }).url;
  return typeof url === 'string' ? url : String(input);
}

export function sanitizePreview(text: string, maxChars = RESPONSE_PREVIEW_CHARS): string {
  const printable = [...text]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? ' ' : char;
    })
    .join('');
  const flattened = printable.replace(/\s+/g, ' ').trim();
  if (flattened.length <= maxChars) return flattened;
  return `${flattened.slice(0, maxChars)}…`;
}

export async function readBodyPreview(
  response: Response,
  maxBytes = RESPONSE_PREVIEW_BYTES,
): Promise<string | null> {
  try {
    const reader = response.clone().body?.getReader();
    if (reader === undefined) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (size < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value !== undefined) {
          chunks.push(value);
          size += value.byteLength;
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return sanitizePreview(new TextDecoder().decode(merged));
  } catch {
    return null;
  }
}

export function wrapProviderFetch(
  inner: typeof globalThis.fetch,
  sink: ProviderResponseSink,
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await inner(input, init);
    const contentType = response.headers.get('content-type');
    const eventStream = isEventStreamContentType(contentType);
    const retryAfterRaw = response.headers.get('retry-after');
    const shape: ProviderResponseShape = {
      url: requestUrl(input),
      status: response.status,
      statusText: response.statusText,
      contentType,
      eventStream,
      retryAfterMs:
        retryAfterRaw === null ? null : parseRetryAfterMs(`retry-after: ${retryAfterRaw}`),
      preview: null,
    };
    sink.current = shape;
    if (!eventStream) {
      shape.preview = await readBodyPreview(response);
    }
    return response;
  };
}

export function describeProviderResponse(
  shape: ProviderResponseShape,
  ctx: ProviderResponseContext,
): string {
  const parts: string[] = [`POST ${shape.url} -> ${shape.status}`];
  parts.push(shape.contentType === null ? '(no content-type)' : shape.contentType);
  if (shape.eventStream) {
    parts.push('(SSE stream)');
  } else {
    parts.push('(not an SSE stream)');
  }
  if (shape.retryAfterMs !== null) {
    parts.push(`retry-after: ${Math.round(shape.retryAfterMs / 1000)}`);
  }
  const facts = [parts.join(' ')];
  if (ctx.providerBaseUrl !== undefined) {
    facts.push(`provider baseUrl "${ctx.providerBaseUrl}"`);
  }
  if (ctx.machineName !== undefined) {
    facts.push(`machine "${ctx.machineName}"`);
  }
  const head = `provider response: ${facts.join('; ')}`;
  if (shape.preview === null) return head;
  return `${head}; first bytes: "${shape.preview}"`;
}

export function enrichProviderError(
  message: string,
  shape: ProviderResponseShape | null,
  ctx: ProviderResponseContext,
): string {
  if (shape === null || shape.eventStream) return message;
  return `${message}\n${describeProviderResponse(shape, ctx)}`;
}
