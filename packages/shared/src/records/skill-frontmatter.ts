import { isAlias, isMap, isScalar, parseDocument, stringify } from 'yaml';
import { MAX_SKILL_FILE_BYTES } from './skill.js';

const SKILL_FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const block = SKILL_FRONTMATTER_RE.exec(content)?.[1];
  if (block === undefined || block.length > MAX_SKILL_FILE_BYTES) return {};
  const document = parseDocument(block, { version: '1.2', schema: 'core', prettyErrors: false });
  if (document.errors.length > 0 || document.warnings.length > 0 || !isMap(document.contents))
    return {};
  const out: { name?: string; description?: string } = {};
  for (const key of ['name', 'description'] as const) {
    let node = document.get(key, true);
    if (isAlias(node)) {
      node = node.resolve(document);
      if (node === undefined) return {};
    }
    if (isScalar(node) && typeof node.value === 'string' && node.value.trim() !== '')
      out[key] = node.value.trim();
  }
  return out;
}

export function splitSkillEntry(content: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const m = SKILL_FRONTMATTER_RE.exec(content);
  if (m === null) return { body: content };
  return {
    ...parseSkillFrontmatter(content),
    body: content.slice(m[0].length).replace(/^(\r?\n)+/, ''),
  };
}

export function buildSkillEntry(name: string, description: string, body: string): string {
  const head = `---\n${stringify({ name, description }, { lineWidth: 0 })}---\n`;
  const trimmed = body.trim();
  return trimmed === '' ? head : `${head}\n${trimmed}\n`;
}
