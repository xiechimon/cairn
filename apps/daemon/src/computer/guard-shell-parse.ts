export type ShellParseEntry =
  | string
  | { op: string }
  | { op: 'glob'; pattern: string }
  | { comment: string }
  | { expansion: string };

export type ShellParseEnv = (name: string) => string | { expansion: string } | undefined;

const CONTROL = `(?:${[
  '\\|\\|',
  '\\&(?:\\&|>>?)',
  ';;\\&?',
  '[;|]\\&',
  '\\<\\(',
  '\\<\\<\\<',
  '\\<\\<-',
  '\\<\\<(?!\\()',
  '>>',
  '>[&|(]',
  '<[&>]',
  '[&;()|<>]',
].join('|')})`;
const CONTROL_RE = new RegExp(`^${CONTROL}$`);
const META = '|&;()<> \\t';
const SINGLE_QUOTE = "'([^']*?)'";
const ANSI_C_BODY = "(?:\\\\[\\s\\S]|[^\\\\'])*?";
const ANSI_C_QUOTE = `\\$'${ANSI_C_BODY}'`;
const ANSI_C_LETTERS = 'abeEfnrtv';
const ANSI_C_CHARS = '\x07\b\x1B\x1B\f\n\r\t\v';
const ANSI_C_ESCAPE =
  /\\([0-7]{1,3}|x[\dA-Fa-f]{1,2}|u[\dA-Fa-f]{1,4}|U[\dA-Fa-f]{1,8}|c(?:\\\\|[\s\S])|[abeEfnrtv\\'"?])/g;
const IFS = ' \t\n';
const BAREWORD = `(\\\\['"$\\\\${META}]|\\$\\$|\\$(?!${ANSI_C_QUOTE.slice(2)})|[^\\s'"$${META}])+`;
const DOUBLE_QUOTE = '"(?:\\\\[\\s\\S]|[^"\\\\])*"';
const CHUNKER_SOURCE = [
  `(${CONTROL})`,
  `(${ANSI_C_QUOTE}|${BAREWORD}|${DOUBLE_QUOTE}|${SINGLE_QUOTE})+`,
].join('|');

function expandAnsiCEscape(match: string, sequence: string): string {
  const kind = sequence.charAt(0);
  if (kind === 'c') {
    const control = sequence.charAt(1);
    return control === '?' ? '\x7F' : String.fromCharCode(control.charCodeAt(0) & 0x1f);
  }
  if (kind === 'x' || kind === 'u' || kind === 'U') {
    const codePoint = Number.parseInt(sequence.slice(1), 16);
    if (codePoint > 0x10ffff) return match;
    return String.fromCodePoint(codePoint);
  }
  if (kind >= '0' && kind <= '7') return String.fromCharCode(Number.parseInt(sequence, 8) & 0xff);
  const letter = ANSI_C_LETTERS.indexOf(sequence);
  return letter < 0 ? sequence : ANSI_C_CHARS.charAt(letter);
}

function expandAnsiC(body: string): string {
  return body.replace(ANSI_C_ESCAPE, expandAnsiCEscape).split('\0')[0] ?? '';
}

function closesAnsiC(source: string, index: number): { closes: boolean; end: number } {
  const pattern = new RegExp(`\\$'${ANSI_C_BODY}(?:(')|\\\\?$)`, 'g');
  pattern.lastIndex = index;
  const match = pattern.exec(source);
  return { closes: Boolean(match?.[1]), end: pattern.lastIndex };
}

function randomToken(): string {
  let token = '';
  for (let part = 0; part < 4; part += 1) token += (0x100000000 * Math.random()).toString(16);
  return token;
}

function matchAll(source: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  let match = pattern.exec(source);
  while (match) {
    matches.push(match);
    if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
    match = pattern.exec(source);
  }
  return matches;
}

export function parseShellWords(source: string, env: ShellParseEnv): ShellParseEntry[] {
  const token = randomToken();
  const startsWithToken = new RegExp(`^${token}`);
  const matches = matchAll(source, new RegExp(CHUNKER_SOURCE, 'g'));
  const entries: ShellParseEntry[] = [];
  let skipUntil = 0;

  const lookup = (name: string): string => {
    const value = env(name);
    if (value === undefined) return name === '' ? '$' : '';
    if (typeof value === 'object') return `${token}${JSON.stringify(value)}${token}`;
    return value;
  };

  for (const match of matches) {
    const chunk = match[0];
    if (!chunk || match.index < skipUntil) continue;
    if (CONTROL_RE.test(chunk)) {
      entries.push({ op: chunk });
      continue;
    }

    let quote: string | false = false;
    let escaped = false;
    let out = '';
    const words: string[] = [];
    let sawQuote = false;
    let pendingSplit = false;
    let isGlob = false;
    let index = 0;
    let finished = false;

    const parseEnvVar = (): string => {
      index += 1;
      let name: string;
      const character = chunk.charAt(index);
      if (character === '{') {
        index += 1;
        if (chunk.charAt(index) === '}') {
          throw new Error(`Bad substitution: ${chunk.slice(index - 2, index + 1)}`);
        }
        let depth = 1;
        let end = index;
        while (depth > 0 && end < chunk.length) {
          if (chunk.charAt(end) === '{' && chunk.charAt(end - 1) === '$') depth += 1;
          else if (chunk.charAt(end) === '}') depth -= 1;
          end += 1;
        }
        if (depth !== 0) throw new Error(`Bad substitution: ${chunk.slice(index)}`);
        end -= 1;
        name = chunk.slice(index, end);
        index = end;
      } else if (/[*@#?$!-]/.test(character)) {
        name = character;
      } else {
        const rest = chunk.slice(index);
        const stop = rest.match(/[^\w\d_]/);
        if (!stop) {
          name = rest;
          index = chunk.length;
        } else {
          name = rest.slice(0, stop.index);
          index += (stop.index ?? 0) - 1;
        }
      }
      return lookup(name);
    };

    const flushRun = () => {
      if (!pendingSplit) return;
      if (out !== '') {
        words.push(out);
        out = '';
      }
      pendingSplit = false;
    };

    for (index = 0; index < chunk.length; index += 1) {
      let character = chunk.charAt(index);
      if (character !== '$') flushRun();
      if (escaped) {
        out += character;
        escaped = false;
      } else if (quote) {
        if (character === quote) quote = false;
        else if (quote === "'") out += character;
        else if (character === '\\') {
          index += 1;
          character = chunk.charAt(index);
          out +=
            character === '"' || character === '\\' || character === '$'
              ? character
              : `\\${character}`;
        } else if (character === '$') out += parseEnvVar();
        else out += character;
      } else if (character === '"' || character === "'") {
        quote = character;
        sawQuote = true;
      } else if (CONTROL_RE.test(character)) {
        entries.push({ op: chunk });
        finished = true;
        break;
      } else if (character === '#' && index === 0) {
        const hashAt = match.index + index;
        const newlineAt = source.indexOf('\n', hashAt);
        const commentEnd = newlineAt === -1 ? source.length : newlineAt;
        entries.push({ comment: source.slice(hashAt + 1, commentEnd) });
        skipUntil = newlineAt === -1 ? source.length : newlineAt + 1;
        finished = true;
        break;
      } else if (character === '\\') {
        escaped = true;
      } else if (
        character === '$' &&
        chunk.charAt(index + 1) === "'" &&
        closesAnsiC(chunk, index).closes
      ) {
        flushRun();
        sawQuote = true;
        const { end } = closesAnsiC(chunk, index);
        out += expandAnsiC(chunk.slice(index + 2, end - 1));
        index = end - 1;
      } else if (character === '$') {
        const value = parseEnvVar();
        for (const valueCharacter of value) {
          if (!IFS.includes(valueCharacter)) {
            flushRun();
            isGlob ||= '*?['.includes(valueCharacter);
            out += valueCharacter;
          } else {
            pendingSplit = true;
          }
        }
      } else {
        isGlob ||= '*?['.includes(character);
        out += character;
      }
    }
    if (finished) continue;

    if (isGlob) {
      entries.push({ op: 'glob', pattern: out });
      continue;
    }
    if (out !== '' || (sawQuote && words.length === 0)) words.push(out);
    entries.push(...words);
  }

  const result: ShellParseEntry[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') {
      result.push(entry);
      continue;
    }
    const parts = entry.split(new RegExp(`(${token}.*?${token})`, 'g'));
    if (parts.length === 1) {
      result.push(parts[0] ?? '');
      continue;
    }
    for (const part of parts.filter(Boolean)) {
      result.push(
        startsWithToken.test(part)
          ? (JSON.parse(part.split(token)[1] ?? 'null') as ShellParseEntry)
          : part,
      );
    }
  }
  return result;
}

export function preserveShellCommandBoundaries(command: string): string {
  let quote: "'" | '"' | undefined;
  let result = '';
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    const next = command[index + 1];
    if (character === '\\' && quote !== "'") {
      if (next === '\n') {
        index += 1;
        continue;
      }
      result += character;
      if (next !== undefined) {
        result += next;
        index += 1;
      }
      continue;
    }
    if (character === quote) quote = undefined;
    else if (!quote && (character === "'" || character === '"')) quote = character;
    result += character === '\n' && !quote ? '\n;' : character;
  }
  return result;
}
