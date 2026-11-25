import { createHash, createHmac } from 'node:crypto';

export interface BackupS3Config {
  endpoint: string;
  bucket: string;
  region: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface BackupObjectStore {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer | null>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string): Promise<string[]>;
}

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const MAX_LIST_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_OBJECT_RESPONSE_BYTES = 2 * 1024 * 1024 * 1024;

function assertSafeObjectKey(key: string): string {
  if (key === '' || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    throw new Error(`unsafe backup object key: ${key}`);
  }
  const segments = key.split('/');
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new Error(`unsafe backup object key: ${key}`);
  }
  return key;
}

async function readBoundedResponse(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = res.headers.get('content-length');
  if (declared !== null) {
    const parsed = Number.parseInt(declared, 10);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      throw new Error('backup object exceeds maximum allowed size');
    }
  }
  if (res.body === null) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('backup object exceeds maximum allowed size');
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}

function validateEndpointUrl(raw: string): URL {
  const parsed = new URL(raw);
  if (parsed.protocol === 'https:') return parsed;
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.includes(parsed.hostname)) return parsed;
  throw new Error('CAIRN_BACKUP_S3_ENDPOINT must use https');
}

export function loadBackupS3Config(env: NodeJS.ProcessEnv = process.env): BackupS3Config | null {
  const endpoint = env.CAIRN_BACKUP_S3_ENDPOINT?.trim() ?? '';
  const bucket = env.CAIRN_BACKUP_S3_BUCKET?.trim() ?? '';
  const accessKeyId = env.CAIRN_BACKUP_S3_ACCESS_KEY_ID?.trim() ?? '';
  const secretAccessKey = env.CAIRN_BACKUP_S3_SECRET_ACCESS_KEY?.trim() ?? '';
  if (endpoint === '' && bucket === '' && accessKeyId === '' && secretAccessKey === '') {
    return null;
  }
  if (endpoint === '' || bucket === '' || accessKeyId === '' || secretAccessKey === '') {
    throw new Error(
      'incomplete S3 backup configuration: set CAIRN_BACKUP_S3_ENDPOINT, CAIRN_BACKUP_S3_BUCKET, CAIRN_BACKUP_S3_ACCESS_KEY_ID, and CAIRN_BACKUP_S3_SECRET_ACCESS_KEY',
    );
  }
  validateEndpointUrl(endpoint);
  const rawPrefix = (env.CAIRN_BACKUP_S3_PREFIX?.trim() ?? 'cairn-backups/').replace(/^\/+/, '');
  const prefix = rawPrefix === '' || rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`;
  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket,
    region: env.CAIRN_BACKUP_S3_REGION?.trim() || 'auto',
    prefix,
    accessKeyId,
    secretAccessKey,
  };
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeUriPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function formatAmzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function signS3Request(input: {
  config: BackupS3Config;
  method: string;
  url: URL;
  payloadHash: string;
  extraHeaders?: Record<string, string>;
  now?: Date;
}): Record<string, string> {
  const { amzDate, dateStamp } = formatAmzDate(input.now ?? new Date());
  const headers: Record<string, string> = {
    host: input.url.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': amzDate,
    ...(input.extraHeaders ?? {}),
  };
  const sortedHeaderKeys = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => {
      const value = Object.entries(headers).find(([name]) => name.toLowerCase() === k)?.[1] ?? '';
      return `${k}:${value.trim().replace(/\s+/g, ' ')}\n`;
    })
    .join('');
  const signedHeaders = sortedHeaderKeys.join(';');
  const queryPairs = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)));
  const canonicalQuery = queryPairs.map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalRequest = [
    input.method,
    input.url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${input.config.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${input.config.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.config.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function decodeXmlEntities(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function parseListKeysXml(xml: string): string[] {
  const keys: string[] = [];
  const pattern = /<Key>([^<]+)<\/Key>/g;
  let match: RegExpExecArray | null = pattern.exec(xml);
  while (match !== null) {
    const raw = match[1];
    if (raw !== undefined) keys.push(decodeXmlEntities(raw));
    match = pattern.exec(xml);
  }
  return keys;
}

export function createS3BackupStore(
  config: BackupS3Config,
  fetchImpl: typeof fetch = globalThis.fetch,
): BackupObjectStore {
  const endpointUrl = validateEndpointUrl(config.endpoint);
  const basePath = endpointUrl.pathname.replace(/\/+$/, '');
  const bucketPrefixPath = `${basePath}/${encodeURIComponent(config.bucket)}/`;
  const objectUrl = (key: string): URL => {
    const safeKey = assertSafeObjectKey(key);
    const url = new URL(endpointUrl.origin);
    url.pathname = `${bucketPrefixPath}${encodeUriPath(safeKey)}`;
    if (!url.pathname.startsWith(bucketPrefixPath)) {
      throw new Error(`unsafe backup object path: ${key}`);
    }
    return url;
  };
  const bucketUrl = (): URL => {
    const url = new URL(endpointUrl.origin);
    url.pathname = `${basePath}/${encodeURIComponent(config.bucket)}`;
    return url;
  };

  return {
    async putObject(key, body, contentType) {
      const url = objectUrl(key);
      const headers = signS3Request({
        config,
        method: 'PUT',
        url,
        payloadHash: sha256(body),
        extraHeaders: { 'content-type': contentType },
      });
      const res = await fetchImpl(url, {
        method: 'PUT',
        headers,
        body: new Uint8Array(body),
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        throw new Error(`backup object upload failed (${res.status})`);
      }
    },

    async getObject(key) {
      const url = objectUrl(key);
      const headers = signS3Request({
        config,
        method: 'GET',
        url,
        payloadHash: sha256(''),
      });
      const res = await fetchImpl(url, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`backup object download failed (${res.status})`);
      }
      return readBoundedResponse(res, MAX_OBJECT_RESPONSE_BYTES);
    },

    async deleteObject(key) {
      const url = objectUrl(key);
      const headers = signS3Request({
        config,
        method: 'DELETE',
        url,
        payloadHash: sha256(''),
      });
      const res = await fetchImpl(url, {
        method: 'DELETE',
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`backup object delete failed (${res.status})`);
      }
    },

    async listObjects(prefix) {
      const url = bucketUrl();
      url.searchParams.set('list-type', '2');
      url.searchParams.set('prefix', prefix);
      const headers = signS3Request({
        config,
        method: 'GET',
        url,
        payloadHash: sha256(''),
      });
      const res = await fetchImpl(url, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        throw new Error(`backup object list failed (${res.status})`);
      }
      const xml = (await readBoundedResponse(res, MAX_LIST_RESPONSE_BYTES)).toString('utf8');
      return parseListKeysXml(xml);
    },
  };
}
