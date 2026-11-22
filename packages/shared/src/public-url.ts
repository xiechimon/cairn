export function publicUrl(raw: string): string {
  const url = URL.canParse(raw) ? new URL(raw) : null;
  if (url !== null && url.origin !== 'null')
    return url.protocol === 'blob:' ? url.origin : `${url.origin}${url.pathname}`;
  return raw
    .replace(/[?#].*$/, '')
    .replace(/(([a-z][a-z0-9+.-]*:)?\/\/)[^/@\s]*@/gi, '$1')
    .replace(/^[^/@\s]*@/, '');
}

export function publicOrigin(raw: string): string {
  const url = URL.canParse(raw) ? new URL(raw) : null;
  return url !== null && url.origin !== 'null' ? url.origin : '';
}
