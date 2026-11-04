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
      throw new Error(`service ${name} env must be a mapping`);
    }
    const envRecord = env as Record<string, unknown>;
    for (const key of Object.keys(envRecord)) {
      if (RESERVED_ENV.has(key) || typeof envRecord[key] !== 'string') {
        throw new Error(`service ${name} env is invalid`);
      }
    }
  }
  if (spec.port !== undefined && (typeof spec.port !== 'number' || !Number.isInteger(spec.port))) {
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
  if (next !== lines.length) throw new Error('yaml trailing content');
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('yaml root must be a mapping');
  }
  return value as Record<string, unknown>;
}

function yamlLines(text: string): YamlLine[] {
  const lines: YamlLine[] = [];
  for (const raw of text.replace(/\t/g, '  ').split(/\r?\n/)) {
    const trimmed = stripInlineComment(raw.trim());
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    lines.push({ indent: raw.length - raw.trimStart().length, text: trimmed });
  }
  return lines;
}

function lineAt(lines: YamlLine[], index: number): YamlLine | undefined {
  return lines[index];
}

function parseBlock(
  lines: YamlLine[],
  index: number,
  parentIndent: number,
): { value: YamlNode; next: number } {
  const current = lineAt(lines, index);
  if (current === undefined || current.indent <= parentIndent) return { value: {}, next: index };
  return current.text.startsWith('- ')
    ? parseList(lines, index)
    : parseMap(lines, index, parentIndent);
}

function parseMap(
  lines: YamlLine[],
  index: number,
  parentIndent: number,
): { value: Record<string, YamlNode>; next: number } {
  const map: Record<string, YamlNode> = {};
  const first = lineAt(lines, index);
  if (first === undefined || first.indent <= parentIndent || first.text.startsWith('- ')) {
    return { value: map, next: index };
  }
  const indent = first.indent;
  for (;;) {
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
      map[key] = parseScalar(rest);
      continue;
    }
    const nestedLine = lineAt(lines, index);
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
  const first = lineAt(lines, index);
  if (first === undefined) return { value: list, next: index };
  const indent = first.indent;
  for (;;) {
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
    if (line === undefined || line.indent <= parentIndent) break;
    chunks.push(line);
    index += 1;
  }
  const base = chunks[0]?.indent ?? parentIndent + 2;
  const folded = indicator.startsWith('>');
  const body = chunks.map((line) => ' '.repeat(Math.max(0, line.indent - base)) + line.text);
  const value = folded ? body.map((line) => line.trim()).join(' ') : body.join('\n');
  return { value, next: index };
}

function parseListItem(rest: string, children: YamlLine[]): YamlNode {
  if (rest !== '' && children.length === 0 && !/^\S+:(?:$| )/.test(rest)) return parseScalar(rest);
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
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) return text.slice(0, i).trimEnd();
  }
  return text;
}

function parseScalar(value: string): YamlNode {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}
