const SUMMARY_MARKER = 'You are a context summarization assistant.';
const MAX_SUMMARY_ATTEMPTS = 4;
const SUMMARY_OUTPUT_BUDGET = 512;
const CEILING_ERROR =
  /maximum context length|prompt is too long|exceeds the context window|context length exceeded|input token count/i;

interface ChatMessage {
  role?: string;
  content?: unknown;
}

interface ChatBody {
  messages?: ChatMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
}

interface SummaryAdjustment {
  body: ChatBody;
  line: string;
}

function withOutput(body: ChatBody, tokens: number): ChatBody {
  if (body.max_completion_tokens !== undefined && body.max_tokens === undefined) {
    return { ...body, max_completion_tokens: tokens };
  }
  return { ...body, max_tokens: tokens };
}

function shrinkTail(text: string, ratio: number): string {
  const keep = Math.max(1, Math.floor(text.length * ratio));
  if (keep >= text.length) return text;
  const marker = `[... ${text.length - keep} characters of older context dropped]\n`;
  if (marker.length + keep >= text.length) return text.slice(text.length - keep);
  return `${marker}${text.slice(text.length - keep)}`;
}

function shrinkConversation(text: string, ratio: number): string {
  const open = '<conversation>\n';
  const close = '\n</conversation>';
  const start = text.indexOf(open);
  const end = text.indexOf(close, start === -1 ? 0 : start + open.length);
  if (start === -1 || end === -1) return shrinkTail(text, ratio);
  const conversation = text.slice(start + open.length, end);
  const blocks = conversation.split('\n\n');
  const target = Math.max(1, Math.floor(conversation.length * ratio));
  let shrunk = shrinkTail(conversation, ratio);
  if (blocks.length > 1) {
    const kept: string[] = [];
    let size = 0;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i] ?? '';
      const extra = kept.length === 0 ? block.length : block.length + 2;
      if (kept.length > 0 && size + extra > target) break;
      kept.push(block);
      size += extra;
    }
    kept.reverse();
    if (kept.length < blocks.length) {
      const dropped = blocks.length - kept.length;
      shrunk = `[... ${dropped} older messages dropped]\n\n${kept.join('\n\n')}`;
    }
  }
  if (shrunk === conversation) return text;
  return text.slice(0, start + open.length) + shrunk + text.slice(end);
}

function replayResponse(response: Response, text: string): Response {
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function adjustSummaryBody(body: ChatBody, errorText: string): SummaryAdjustment | null {
  const windowMatch = /maximum context length is (\d+)/i.exec(errorText);
  const inputMatch = /at least (\d+) input tokens/i.exec(errorText);
  const outputMatch = /requested (\d+) output tokens/i.exec(errorText);
  const window = windowMatch ? Number(windowMatch[1]) : null;
  const input = inputMatch ? Number(inputMatch[1]) : null;
  const output = outputMatch
    ? Number(outputMatch[1])
    : (body.max_tokens ?? body.max_completion_tokens ?? 0);
  if (window !== null && input !== null) {
    const fitted = window - input - 1;
    if (fitted >= 1 && output > fitted) {
      return {
        body: withOutput(body, fitted),
        line: `compaction summary exceeded the context window (provider input ${input}, requested output ${output}, window ${window}); retrying with max_tokens ${fitted}`,
      };
    }
  }
  let ratio = 0.5;
  if (window !== null && input !== null && input > 0) {
    const fit = ((window - SUMMARY_OUTPUT_BUDGET) / input) * 0.9;
    ratio = !Number.isFinite(fit) || fit <= 0 ? 0.25 : Math.min(0.5, Math.max(0.05, fit));
  }
  if (!Array.isArray(body.messages)) return null;
  let changed = false;
  const messages = body.messages.map((message) => {
    if (message.role !== 'user') return message;
    const content = message.content;
    let next: unknown = content;
    if (typeof content === 'string') {
      const shrunk = shrinkConversation(content, ratio);
      if (shrunk !== content) next = shrunk;
    } else if (Array.isArray(content)) {
      let partsChanged = false;
      const parts = content.map((part) => {
        if (!part || typeof part !== 'object') return part;
        const text = (part as { text?: unknown }).text;
        if (typeof text !== 'string') return part;
        const shrunk = shrinkConversation(text, ratio);
        if (shrunk === text) return part;
        partsChanged = true;
        return { ...(part as Record<string, unknown>), text: shrunk };
      });
      if (partsChanged) next = parts;
    }
    if (next === content) return message;
    changed = true;
    return { ...message, content: next };
  });
  if (!changed) return null;
  const shrunk: ChatBody = { ...body, messages };
  const estimatedInput = input !== null ? Math.max(1, Math.ceil(input * ratio)) : null;
  let adjusted = shrunk;
  if (window !== null && estimatedInput !== null) {
    const room = window - estimatedInput - 1;
    if (room >= 1) adjusted = withOutput(shrunk, Math.min(SUMMARY_OUTPUT_BUDGET, room));
  } else if (output > SUMMARY_OUTPUT_BUDGET) {
    adjusted = withOutput(shrunk, SUMMARY_OUTPUT_BUDGET);
  }
  if (JSON.stringify(adjusted).length >= JSON.stringify(body).length) return null;
  const detail =
    window !== null && input !== null ? ` (provider input ${input}, window ${window})` : '';
  return {
    body: adjusted,
    line: `compaction summary exceeded the context window${detail}; dropped older conversation text and retrying`,
  };
}

export function compactionCeilingFetch(
  inner: typeof fetch,
  log: (line: string) => void = () => {},
): typeof fetch {
  return async (input, init) => {
    const original = typeof init?.body === 'string' ? init.body : null;
    if (original === null || !original.includes(SUMMARY_MARKER)) return inner(input, init);
    let current: ChatBody;
    try {
      current = JSON.parse(original) as ChatBody;
    } catch {
      return inner(input, init);
    }
    if (!Array.isArray(current.messages)) return inner(input, init);
    let lastResponse: Response | null = null;
    let lastText = '';
    let attempts = 0;
    for (let attempt = 1; attempt <= MAX_SUMMARY_ATTEMPTS; attempt++) {
      attempts = attempt;
      const response = await inner(input, { ...init, body: JSON.stringify(current) });
      if (response.status !== 400 && response.status !== 413) return response;
      const text = await response.text();
      if (!CEILING_ERROR.test(text)) return replayResponse(response, text);
      lastResponse = response;
      lastText = text;
      if (attempt === MAX_SUMMARY_ATTEMPTS) break;
      const next = adjustSummaryBody(current, text);
      if (next === null) break;
      current = next.body;
      log(next.line);
    }
    const flat = lastText.replace(/\s+/g, ' ').trim();
    const preview = flat.length <= 240 ? flat : `${flat.slice(0, 240)}…`;
    log(`compaction summary hit the context ceiling after ${attempts} attempts: ${preview}`);
    if (lastResponse === null) return inner(input, init);
    return replayResponse(lastResponse, lastText);
  };
}
