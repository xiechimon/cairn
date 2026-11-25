export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  FEEDBACK_LABEL?: string;
}

interface FeedbackPayload {
  id?: unknown;
  createdAt?: unknown;
  message?: unknown;
  route?: unknown;
  errorSummary?: unknown;
  context?: {
    platform?: unknown;
    arch?: unknown;
    node?: unknown;
  };
  logs?: unknown;
}

const MAX_BODY_BYTES = 48_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_IP = 5;
const GLOBAL_RATE_LIMIT = 30;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
let globalBucket = { count: 0, resetAt: 0 };

function rateLimited(ip: string, now: number): boolean {
  if (globalBucket.resetAt <= now) {
    globalBucket = { count: 1, resetAt: now + RATE_WINDOW_MS };
  } else {
    globalBucket.count += 1;
    if (globalBucket.count > GLOBAL_RATE_LIMIT) return true;
  }
  if (rateBuckets.size > 500) {
    for (const [key, bucket] of rateBuckets) {
      if (bucket.resetAt <= now) rateBuckets.delete(key);
    }
  }
  const existing = rateBuckets.get(ip);
  if (existing === undefined || existing.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  existing.count += 1;
  return existing.count > RATE_LIMIT_PER_IP;
}

function cleanInline(value: unknown, fallback: string, maxLen: number): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\r\n`]+/g, ' ').trim();
  return cleaned === '' ? fallback : cleaned.slice(0, maxLen);
}

function fenceFor(content: string): string {
  let longest = 2;
  for (const match of content.matchAll(/`+/g)) {
    if (match[0].length > longest) longest = match[0].length;
  }
  return '`'.repeat(longest + 1);
}

function buildIssueTitle(message: string): string {
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const summary = firstLine.length > 72 ? `${firstLine.slice(0, 72)}…` : firstLine;
  return `[Feedback] ${summary || 'User bug report'}`;
}

function buildIssueBody(payload: FeedbackPayload, message: string): string {
  const ctx = typeof payload.context === 'object' && payload.context !== null ? payload.context : {};
  const lines = [
    message.slice(0, 4_000),
    '',
    '### Context',
    `- Feedback ID: \`${cleanInline(payload.id, 'unknown', 64)}\``,
    `- Platform: \`${cleanInline(ctx.platform, 'unknown', 32)} / ${cleanInline(ctx.arch, 'unknown', 32)}\``,
    `- Node: \`${cleanInline(ctx.node, 'unknown', 32)}\``,
  ];
  const route = cleanInline(payload.route, '', 256);
  if (route !== '') lines.push(`- Route: \`${route}\``);
  const errorSummary = cleanInline(payload.errorSummary, '', 512);
  if (errorSummary !== '') lines.push(`- Error summary: \`${errorSummary}\``);
  if (typeof payload.logs === 'string' && payload.logs.trim() !== '') {
    const trimmedLogs = payload.logs.slice(0, 16_000);
    const fence = fenceFor(trimmedLogs);
    lines.push(
      '',
      '<details>',
      '<summary>Sanitized diagnostics logs</summary>',
      '',
      `${fence}text`,
      trimmedLogs,
      fence,
      '</details>',
    );
  }
  return lines.join('\n');
}

async function readBoundedUtf8(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return Response.json({ ok: true, service: 'cairn-feedback-relay' });
    }
    if (request.method !== 'POST' || url.pathname !== '/submit') {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return Response.json({ error: 'Unsupported media type' }, { status: 415 });
    }
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (rateLimited(ip, Date.now())) {
      return Response.json({ error: 'Too many requests' }, { status: 429 });
    }
    const raw = await readBoundedUtf8(request, MAX_BODY_BYTES);
    if (raw === null) {
      return Response.json({ error: 'Payload too large' }, { status: 413 });
    }
    let payload: FeedbackPayload;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      payload = parsed as FeedbackPayload;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (message === '') {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }
    const repo = env.GITHUB_REPO || 'xiechimon/cairn';
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'cairn-feedback-relay',
      },
      body: JSON.stringify({
        title: buildIssueTitle(message),
        body: buildIssueBody(payload, message),
        labels: [env.FEEDBACK_LABEL || 'user-feedback'],
      }),
    });
    if (!res.ok) {
      return Response.json({ error: 'Upstream issue creation failed' }, { status: 502 });
    }
    const issue = (await res.json()) as { number: number; html_url: string };
    return Response.json(
      { ok: true, id: `#${issue.number}`, issueUrl: issue.html_url },
      { status: 201 },
    );
  },
};
