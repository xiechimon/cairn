// 非 SSE 响应形态诊断（#882）。
//
// 缺口：provider `baseUrl` 少一段（典型是漏掉 `/v1`）时，请求打到站点的 SPA
// 路由，拿回 **200 text/html**。pi 的流解析器找不到任何 `finish_reason`，抛的
// 是笼统的 `Stream ended without finish_reason`——看着像模型 / 通道坏，实际是
// 端点形态不对。HTTP 层的真话（status / content-type / 前若干字节 / 打到哪个
// URL）全在解析器之下被丢掉，只有本地记录代理才查得出来。
//
// 本模块把那一层捡回来：注入进 pi 请求面的 `fetch` 旁路记录每次响应的形态
// （不改写请求、不改写响应、正常 SSE 零开销），pi 的失败文案出来时再把它拼上去。
// 缝纪律：本文件不 import `@earendil-works/*`——`fetch` 契约是 WHATWG 标准面，
// 宿主（pi.ts）负责把它接进 pi 的请求选项。

import { parseRetryAfterMs } from '@cairn/shared';

/** 响应形态记录（每次 provider HTTP 响应一份）。 */
export interface ProviderResponseShape {
  /** 真实请求 URL（含 provider baseUrl 与路径）——baseUrl 少一段时这里看得出来。 */
  url: string;
  status: number;
  statusText: string;
  /** 响应头 `content-type` 原文；缺失 = null。 */
  contentType: string | null;
  /** 响应体是不是 SSE 流（content-type = text/event-stream）。 */
  eventStream: boolean;
  /** #1261 响应头 `retry-after`（限流恢复窗，毫秒）：429/529 诊断行携带，
   *  quotaBlock.retryAfterMs 的数据源。缺失/非法 = null（不造数值）。 */
  retryAfterMs: number | null;
  /** 非 SSE 时的前若干字节摘要（空白折叠、控制字符剥除、截断）；SSE = null
   *  （流不读、不缓存：正常路径零开销）。读取失败 = null（诊断降级，不炸）。 */
  preview: string | null;
}

/** 记录槽。`current` = 最近一次 provider 响应的形态；宿主每次会话建一个新槽，
 *  步与步之间不串（每步一个新 runtime，见 backend/pi.ts open()）。 */
export interface ProviderResponseSink {
  current: ProviderResponseShape | null;
}

/** 诊断文案的上下文位（哪台机器 / 哪个 baseUrl）。 */
export interface ProviderResponseContext {
  machineName?: string;
  providerBaseUrl?: string;
}

/** 读体上限（字节）。够认出「这是一张 HTML 页面 / 一段 JSON」即可。 */
export const RESPONSE_PREVIEW_BYTES = 512;
/** 摘要落文上限（字符，折叠空白之后）。 */
export const RESPONSE_PREVIEW_CHARS = 200;

/** content-type 是不是 SSE 流（大小写不敏感；带 charset 参数照认）。 */
export function isEventStreamContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  return /^\s*text\/event-stream\b/i.test(contentType);
}

/** 请求输入 → URL 字符串（fetch 三种入参形态：string / URL / Request）。 */
function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  const url = (input as { url?: unknown }).url;
  return typeof url === 'string' ? url : String(input);
}

/** 折叠空白 + 剥控制字符 + 截断（响应体可能含换行、NUL、超长单行）。
 *  逐字符按码点过滤（而非控制字符正则：本仓 lint 把控制字符正则当可疑输入，
 *  这里的过滤正是它的用例，写成显式循环两边都不用让步）。 */
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

/** 从响应体克隆里读前若干字节（不消费原响应；读完即取消克隆分支）。
 *  任何失败 = null：诊断是附注，不该把一次请求弄坏。 */
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

/** 注入 pi 请求面的 `fetch`：旁路记录响应形态，响应原样返回。
 *
 *  正常 SSE 只做一次头判定（不读体、不克隆），零延迟；非 SSE 才读前若干字节
 *  ——那条路径上响应体本来就小（HTML 页面 / JSON 错误），且 SDK 自己也要读。 */
export function wrapProviderFetch(
  inner: typeof globalThis.fetch,
  sink: ProviderResponseSink,
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await inner(input, init);
    const contentType = response.headers.get('content-type');
    const eventStream = isEventStreamContentType(contentType);
    // #1261 Retry-After 头：值是裸秒数（"5"），parseRetryAfterMs 的词法要
    // 「retry-after」关键字在文——拼回头形再解析（同一函数同一次词法，诊断
    // 行与 quotaBlock 的数值不会漂移）。
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
    // 先落判定再读体：读取失败 / 超时都不影响「不是 SSE」这条结论。
    sink.current = shape;
    if (!eventStream) {
      shape.preview = await readBodyPreview(response);
    }
    return response;
  };
}

/** 形态 → 一行诊断文案。 */
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
  // #1261：Retry-After 头原文进诊断行（毫秒化与解析单源 = shared
  // parseRetryAfterMs——runner 侧对同一函数再解析诊断行，数值双端一致）。
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

/** pi 失败文案 + 响应形态 = 宿主可见的失败文案。
 *
 *  只在**响应不是 SSE 流**时追加：正确的 SSE 上出的错（流中途断、模型报错）
 *  与端点形态无关，那时候追加形态只是噪音。没有记录（适配器不吃注入的
 *  fetch / 请求没发出去）也原样返回——诊断 fail-open，绝不改坏既有文案。 */
export function enrichProviderError(
  message: string,
  shape: ProviderResponseShape | null,
  ctx: ProviderResponseContext,
): string {
  if (shape === null || shape.eventStream) return message;
  return `${message}\n${describeProviderResponse(shape, ctx)}`;
}
