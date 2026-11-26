function withoutQueryOrFragment(raw: string): string {
  const lastLineBreak = Math.max(
    ...['\n', '\r', '\u2028', '\u2029'].map((c) => raw.lastIndexOf(c)),
  );
  const start = raw.slice(lastLineBreak + 1).search(/[?#]/);
  return start < 0 ? raw : raw.slice(0, lastLineBreak + 1 + start);
}

export function publicUrl(raw: string): string {
  const url = URL.canParse(raw) ? new URL(raw) : null;
  if (url !== null && url.origin !== 'null')
    return url.protocol === 'blob:' ? url.origin : `${url.origin}${url.pathname}`;
  return withoutQueryOrFragment(raw)
    .replace(/(\/\/)[^/@\s]*@/g, '$1')
    .replace(/^[^/@\s]*@/, '');
}

export function publicOrigin(raw: string): string {
  const url = URL.canParse(raw) ? new URL(raw) : null;
  return url !== null && url.origin !== 'null' ? url.origin : '';
}
