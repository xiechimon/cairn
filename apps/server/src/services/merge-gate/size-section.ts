const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FOLD_MARKUP = /<\/?details\b[^>]*>|<summary\b[^>]*>[\s\S]*?<\/summary\s*>/gi;

function outsideFences(body: string): string[] {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const marker = FENCE.exec(line)?.[1] ?? null;
    if (fence !== null) {
      if (marker !== null && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      lines.push('');
    } else if (marker !== null) {
      fence = marker;
      lines.push('');
    } else {
      lines.push(line);
    }
  }
  return lines;
}

export function sizeSection(body: string | null): string | null {
  if (body === null) return null;
  const lines = outsideFences(body.replace(COMMENT, (c) => c.replace(/[^\n]/g, ' ')));
  const start = lines.findIndex((line) => {
    const heading = HEADING.exec(line);
    return heading?.[1] === '##' && heading[2]?.toLowerCase() === 'size';
  });
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const level = HEADING.exec(line)?.[1]?.length;
    return level !== undefined && level <= 2;
  });
  const section = (end < 0 ? rest : rest.slice(0, end)).join('\n');
  const text = section.replace(FOLD_MARKUP, '').trim();
  return text === '' ? null : text;
}
