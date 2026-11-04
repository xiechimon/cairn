import type { OrbEnsureService } from './services-ensure.js';

const RESERVED_ENV = new Set(['PORT', 'PUBLIC_URL', 'AMP_THREAD_ID']);
const SERVICE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

type YamlNode = string | number | boolean | null | YamlNode[] | { [key: string]: YamlNode };
type YamlLine = { indent: number; text: string };

export function loadEnsureServicesFile(text: string): OrbEnsureService[] {
  const parsed = parseYamlMapping(text);
  const services = parsed.services;
  if (services === undefined || typeof services !== 'object' || Array.isArray(services)) {
    throw new Error('services.yaml must contain a nonempty services mapping');
  }
  const records = services as Record<string, unknown>;
  const names = Object.keys(records);
  if (names.length === 0) throw new Error('services.yaml must contain a nonempty services mapping');
  return names.map((name) => serviceFromUnknown(name, records[name]));
}

function serviceFromUnknown(name: string, raw: unknown): OrbEnsureService {
  if (!SERVICE_NAME_RE.test(name)) throw new Error(`service name ${name} is invalid`);
  if (raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`service ${name} must be a mapping`);
  }
  const spec = raw as Record<string, unknown>;
  if (typeof spec.command !== 'string' || spec.command.length === 0) {
    throw new Error(`service ${name} requires command`);
  }
  const env = spec.env;
  if (env !== undefined) {
    if (typeof env !== 'object' || env === null || Array.isArray(env)) {
      throw new Error(`service ${name} env is invalid`);
    }
    const envRecord = env as Record<string, unknown>;
    for (const key of Object.keys(envRecord)) {
      if (RESERVED_ENV.has(key) || typeof envRecord[key] !== 'string') {
        throw new Error(`service ${name} env is invalid`);
      }
    }
  }
  if (
    spec.port !== undefined &&
    (typeof spec.port !== 'number' ||
      !Number.isInteger(spec.port) ||
      spec.port < 1 ||
      spec.port > 65535)
  ) {
    throw new Error(`service ${name} port is invalid`);
  }
  if (
    spec.health !== undefined &&
    (typeof spec.health !== 'string' || !spec.health.startsWith('/'))
  ) {
    throw new Error(`service ${name} health is invalid`);
  }
  if (spec.cwd !== undefined && (typeof spec.cwd !== 'string' || spec.cwd.length === 0)) {
    throw new Error(`service ${name} cwd is invalid`);
  }
  return {
    name,
    command: spec.command,
    ...(typeof spec.cwd === 'string' ? { cwd: spec.cwd } : {}),
    ...(typeof spec.port === 'number' ? { port: spec.port } : {}),
    ...(env !== undefined ? { env: env as Record<string, string> } : {}),
    ...(typeof spec.health === 'string' ? { health: spec.health } : {}),
  };
}

export function parseYamlMapping(text: string): Record<string, unknown> {
  const lines = yamlLines(text);
  const { value, next } = parseBlock(lines, 0, -1);
  const end = skipCommentsAndBlanks(lines, next);
  if (end !== lines.length) throw new Error('yaml trailing content');
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('yaml root must be a mapping');
  }
  return value as Record<string, unknown>;
}

function yamlLines(text: string): YamlLine[] {
  const lines: YamlLine[] = [];
  for (const raw of text.replace(/\t/g, '  ').split(/\r?\n/)) {
    lines.push({ indent: raw.length - raw.trimStart().length, text: raw.trim() });
  }
  return lines;
}

function lineAt(lines: YamlLine[], index: number): YamlLine | undefined {
  return lines[index];
}

function isCommentOrBlank(line: YamlLine): boolean {
  return line.text === '' || line.text.startsWith('#');
}

function parseBlock(
  lines: YamlLine[],
  index: number,
  parentIndent: number,
): { value: YamlNode; next: number } {
  index = skipCommentsAndBlanks(lines, index);
  const current = lineAt(lines, index);
  if (current === undefined || current.indent <= parentIndent) return { value: {}, next: index };
  return current.text.startsWith('- ')
    ? parseList(lines, index)
    : parseMap(lines, index, parentIndent);
}

function skipCommentsAndBlanks(lines: YamlLine[], index: number): number {
  for (;;) {
    const line = lineAt(lines, index);
    if (line === undefined || !isCommentOrBlank(line)) return index;
    index += 1;
  }
}

function parseMap(
  lines: YamlLine[],
  index: number,
  parentIndent: number,
): { value: Record<string, YamlNode>; next: number } {
  const map: Record<string, YamlNode> = {};
  index = skipCommentsAndBlanks(lines, index);
  const first = lineAt(lines, index);
  if (first === undefined || first.indent <= parentIndent || first.text.startsWith('- ')) {
    return { value: map, next: index };
  }
  const indent = first.indent;
  for (;;) {
    index = skipCommentsAndBlanks(lines, index);
    const current = lineAt(lines, index);
    if (current === undefined || current.indent !== indent || current.text.startsWith('- ')) break;
    const match = /^([^:]+):(.*)$/.exec(current.text);
    const key = match?.[1];
    const rawRest = match?.[2];
    if (match === null || key === undefined || rawRest === undefined) {
      throw new Error(`yaml mapping line is invalid: ${current.text}`);
    }
    const rest = rawRest.startsWith(' ') ? rawRest.slice(1) : rawRest;
    index += 1;
    if (/^[|>][-+]?$/.test(rest)) {
      const block = parseBlockScalar(lines, index, indent, rest);
      map[key] = block.value;
      index = block.next;
      continue;
    }
    if (rest !== '') {
      map[key] = parseScalar(stripInlineComment(rest));
      continue;
    }
    const nestedLine = lineAt(lines, skipCommentsAndBlanks(lines, index));
    if (nestedLine !== undefined && nestedLine.indent > indent) {
      const nested = parseBlock(lines, index, indent);
      map[key] = nested.value;
      index = nested.next;
    } else {
      map[key] = {};
    }
  }
  return { value: map, next: index };
}

function parseList(lines: YamlLine[], index: number): { value: YamlNode[]; next: number } {
  const list: YamlNode[] = [];
  index = skipCommentsAndBlanks(lines, index);
  const first = lineAt(lines, index);
  if (first === undefined) return { value: list, next: index };
  const indent = first.indent;
  for (;;) {
    index = skipCommentsAndBlanks(lines, index);
    const current = lineAt(lines, index);
    if (current === undefined || current.indent !== indent || !current.text.startsWith('- ')) {
      break;
    }
    const rest = current.text.slice(2);
    index += 1;
    const children: YamlLine[] = [];
    for (;;) {
      const child = lineAt(lines, index);
      if (child === undefined || child.indent <= indent) break;
      children.push(child);
      index += 1;
    }
    list.push(parseListItem(rest, children));
  }
  return { value: list, next: index };
}

function parseBlockScalar(
  lines: YamlLine[],
  index: number,
  parentIndent: number,
  indicator: string,
): { value: string; next: number } {
  const chunks: YamlLine[] = [];
  for (;;) {
    const line = lineAt(lines, index);
    if (line === undefined) break;
    if (line.text === '') {
      chunks.push(line);
      index += 1;
      continue;
    }
    if (line.indent <= parentIndent) break;
    chunks.push(line);
    index += 1;
  }
  while (chunks.length > 0 && chunks[chunks.length - 1]?.text === '') chunks.pop();
  const firstContent = chunks.find((line) => line.text !== '');
  const base = firstContent?.indent ?? parentIndent + 2;
  const folded = indicator.startsWith('>');
  const body = chunks.map((line) =>
    line.text === '' ? '' : ' '.repeat(Math.max(0, line.indent - base)) + line.text,
  );
  const value = folded ? foldYamlLines(body) : body.join('\n');
  return { value, next: index };
}

function foldYamlLines(lines: string[]): string {
  const paragraphs: string[] = [];
  let words: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (words.length > 0) {
        paragraphs.push(words.join(' '));
        words = [];
      }
      continue;
    }
    words.push(line.trim());
  }
  if (words.length > 0) paragraphs.push(words.join(' '));
  return paragraphs.join('\n');
}

function parseListItem(rest: string, children: YamlLine[]): YamlNode {
  if (rest !== '' && children.length === 0 && !/^\S+:(?:$| )/.test(rest)) {
    return parseScalar(stripInlineComment(rest));
  }
  const base = children[0]?.indent ?? 0;
  const itemLines: YamlLine[] = [
    ...(rest !== '' ? [{ indent: 0, text: rest }] : []),
    ...children.map((line) => ({ indent: line.indent - base, text: line.text })),
  ];
  return parseBlock(itemLines, 0, -1).value;
}

function stripInlineComment(text: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inDouble) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          i += 1;
          continue;
        }
        inSingle = false;
      }
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === '#' && (i === 0 || /\s/.test(text[i - 1] ?? ''))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text;
}

function decodeDoubleQuoted(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) {
      out += '\\';
      break;
    }
    i += 1;
    if (next === 'n') out += '\n';
    else if (next === 't') out += '\t';
    else if (next === 'r') out += '\r';
    else out += next;
  }
  return out;
}

function parseScalar(value: string): YamlNode {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return decodeDoubleQuoted(value.slice(1, -1));
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}
