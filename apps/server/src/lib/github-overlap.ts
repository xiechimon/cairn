import { HttpError } from './errors.js';
import type { FetchLike } from './github.js';

export async function githubOverlapItems(
  fetchImpl: FetchLike,
  token: string,
  path: string,
  signal: AbortSignal,
): Promise<unknown[]> {
  const url = new URL(`https://api.github.com/${path}`);
  const search = url.pathname === '/search/issues';
  const items: unknown[] = [];
  let bytes = 0;
  for (let page = 1; page <= 100; page++) {
    url.searchParams.set('page', String(page));
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'cairn-server',
      },
      signal,
    });
    if (!response.ok)
      throw new HttpError(
        response.status,
        `GitHub overlap lookup failed (HTTP ${response.status})`,
      );
    const data = await response.json();
    let entries: unknown = data;
    let total: number | undefined;
    if (search) {
      if (
        typeof data !== 'object' ||
        data === null ||
        !('items' in data) ||
        !('total_count' in data) ||
        typeof data.total_count !== 'number' ||
        !Number.isSafeInteger(data.total_count) ||
        data.total_count < 0 ||
        !('incomplete_results' in data) ||
        data.incomplete_results !== false ||
        data.total_count > 1000
      )
        throw new HttpError(
          502,
          'Incomplete or malformed GitHub overlap search; narrow terms and repeat',
        );
      entries = data.items;
      total = data.total_count;
    }
    if (!Array.isArray(entries)) throw new HttpError(502, 'Malformed GitHub overlap response');
    bytes += Buffer.byteLength(JSON.stringify(entries), 'utf8');
    if (bytes > 8 * 1024 * 1024)
      throw new HttpError(413, 'GitHub overlap page data exceeds 8 MiB; narrow the lookup');
    items.push(...entries);
    if (url.pathname.endsWith('/files') && items.length >= 3000)
      throw new HttpError(502, 'GitHub PR file limit reached; overlap lookup is incomplete');
    if (!(response.headers.get('link') ?? '').includes('rel="next"')) {
      if (total !== undefined && items.length !== total)
        throw new HttpError(502, 'Incomplete GitHub overlap search pages');
      return items;
    }
    if (entries.length === 0) throw new HttpError(502, 'Incomplete GitHub overlap pagination');
  }
  throw new HttpError(502, 'GitHub overlap page limit reached');
}
