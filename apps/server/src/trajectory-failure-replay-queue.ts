import { type FailureReplayCandidate, otlpTraceIdOfBuild } from '@cairn/shared';
import { z } from 'zod';
import { FailureReplayError } from './trajectory-failure-replay.js';

export interface LangfuseAnnotationTarget {
  host: string;
  publicKey: string;
  secretKey: string;
  queueId: string;
}

export interface AnnotationQueueItem {
  id: string;
  queueId: string;
  objectId: string;
  objectType: 'TRACE' | 'OBSERVATION' | 'SESSION';
  status: 'PENDING' | 'COMPLETED';
}

const queueItemSchema = z.object({
  id: z.string(),
  queueId: z.string(),
  objectId: z.string(),
  objectType: z.enum(['TRACE', 'OBSERVATION', 'SESSION']),
  status: z.enum(['PENDING', 'COMPLETED']),
});

const listResponseSchema = z.object({
  data: z.array(queueItemSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    totalItems: z.number(),
    totalPages: z.number(),
  }),
});

export function parseLangfuseAnnotationTarget(env: {
  CAIRN_LANGFUSE_HOST?: string;
  CAIRN_LANGFUSE_PUBLIC_KEY?: string;
  CAIRN_LANGFUSE_SECRET_KEY?: string;
  CAIRN_LANGFUSE_ANNOTATION_QUEUE_ID?: string;
}): LangfuseAnnotationTarget {
  const host = env.CAIRN_LANGFUSE_HOST?.replace(/\/+$/, '');
  const publicKey = env.CAIRN_LANGFUSE_PUBLIC_KEY;
  const secretKey = env.CAIRN_LANGFUSE_SECRET_KEY;
  const queueId = env.CAIRN_LANGFUSE_ANNOTATION_QUEUE_ID;
  if (!host || !publicKey || !secretKey || !queueId) {
    throw new FailureReplayError(
      'Set CAIRN_LANGFUSE_HOST, CAIRN_LANGFUSE_PUBLIC_KEY, CAIRN_LANGFUSE_SECRET_KEY, and CAIRN_LANGFUSE_ANNOTATION_QUEUE_ID',
    );
  }
  let url: URL;
  try {
    url = new URL(host);
  } catch {
    throw new FailureReplayError('CAIRN_LANGFUSE_HOST is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new FailureReplayError('CAIRN_LANGFUSE_HOST must be http or https');
  return { host: url.origin, publicKey, secretKey, queueId };
}

function authHeader(target: LangfuseAnnotationTarget): string {
  return `Basic ${Buffer.from(`${target.publicKey}:${target.secretKey}`).toString('base64')}`;
}

async function langfuseFetch(
  target: LangfuseAnnotationTarget,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(`${target.host}${path}`, {
    ...init,
    headers: {
      authorization: authHeader(target),
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok)
    throw new FailureReplayError(`Langfuse annotation queue replied HTTP ${response.status}`);
  return response;
}

export interface EnqueueResult {
  enqueued: number;
  skipped: number;
}

export async function enqueueFailureReplayCandidates(
  candidates: FailureReplayCandidate[],
  target: LangfuseAnnotationTarget,
): Promise<EnqueueResult> {
  let enqueued = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    if (candidate.status !== 'pending') {
      skipped++;
      continue;
    }
    await langfuseFetch(target, `/api/public/annotation-queues/${target.queueId}/items`, {
      method: 'POST',
      body: JSON.stringify({
        objectId: otlpTraceIdOfBuild(candidate.buildId),
        objectType: 'TRACE',
        status: 'PENDING',
      }),
    });
    enqueued++;
  }
  return { enqueued, skipped };
}

export async function listCompletedFailureReplayItems(
  target: LangfuseAnnotationTarget,
): Promise<AnnotationQueueItem[]> {
  const items: AnnotationQueueItem[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const response = await langfuseFetch(
      target,
      `/api/public/annotation-queues/${target.queueId}/items?status=COMPLETED&page=${page}&limit=50`,
    );
    const body = listResponseSchema.parse(await response.json());
    items.push(...body.data);
    totalPages = body.meta.totalPages;
    page++;
  }
  return items;
}
