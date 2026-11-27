export function stripHtmlTags(markup: string): string {
  let out = '';
  let insideTag = false;
  for (let i = 0; i < markup.length; i++) {
    const ch = markup[i];
    if (ch === '<') {
      insideTag = true;
    } else if (insideTag) {
      if (ch === '>') insideTag = false;
    } else {
      out += ch;
    }
  }
  return out;
}
