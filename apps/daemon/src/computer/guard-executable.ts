import {
  parseShellWords,
  preserveShellCommandBoundaries,
  type ShellParseEntry,
} from './guard-shell-parse.js';

const WRAPPER_OPTIONS: Readonly<Record<string, { values: string[]; flags: string[] }>> = {
  command: { values: [], flags: ['p'] },
  builtin: { values: [], flags: [] },
  exec: { values: ['a'], flags: ['c', 'l'] },
  env: {
    values: ['u', 'unset', 'C', 'chdir', 'a', 'argv0', 'S', 'split-string'],
    flags: ['i', 'ignore-environment', '0', 'null', 'v', 'debug'],
  },
  sudo: {
    values: [
      'u',
      'user',
      'g',
      'group',
      'h',
      'host',
      'p',
      'prompt',
      'C',
      'close-from',
      'T',
      'command-timeout',
      'R',
      'chroot',
      'D',
      'chdir',
      'r',
      'role',
      't',
      'type',
    ],
    flags: [
      'A',
      'askpass',
      'b',
      'background',
      'E',
      'preserve-env',
      'H',
      'set-home',
      'k',
      'K',
      'n',
      'non-interactive',
      'P',
      'preserve-groups',
      'S',
      'stdin',
    ],
  },
  nice: { values: ['n', 'adjustment'], flags: [] },
  nohup: { values: [], flags: [] },
  stdbuf: { values: ['i', 'input', 'o', 'output', 'e', 'error'], flags: [] },
  time: {
    values: ['f', 'format', 'o', 'output'],
    flags: ['p', 'portability', 'v', 'verbose', 'a', 'append', 'q', 'quiet'],
  },
};

type Word = string | { op: 'glob'; pattern: string };

function commandPattern(words: readonly Word[]): boolean {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (word === undefined) return false;
    if (typeof word !== 'string') return true;
    if (
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(word) ||
      /^(?:!|if|elif|while|until|then|do|else|\{)$/.test(word)
    ) {
      index += 1;
      continue;
    }
    const base = word.split('/').at(-1) ?? word;
    const options = WRAPPER_OPTIONS[base];
    if (!options) return false;
    index += 1;
    while (index < words.length) {
      const option = words[index];
      if (typeof option !== 'string' || !option.startsWith('-') || option === '-') break;
      index += 1;
      if (option === '--') break;
      if (
        (base === 'command' && /^-[vV]$/.test(option)) ||
        option === '--help' ||
        option === '--version'
      )
        return false;
      if (base === 'nice' && /^-\d+$/.test(option)) continue;
      if (option.startsWith('--')) {
        const separator = option.indexOf('=');
        const name = separator === -1 ? option.slice(2) : option.slice(2, separator);
        if (options.values.includes(name)) {
          if (separator === -1) index += 1;
          continue;
        }
        if (options.flags.includes(name)) continue;
        return words.slice(index).some((entry) => typeof entry !== 'string');
      }
      let known = true;
      for (let letter = 1; letter < option.length; letter += 1) {
        const name = option[letter] ?? '';
        if (options.values.includes(name)) {
          if (letter === option.length - 1) index += 1;
          break;
        }
        if (!options.flags.includes(name)) {
          known = false;
          break;
        }
      }
      if (!known) return words.slice(index).some((entry) => typeof entry !== 'string');
    }
  }
  return false;
}

export function shellExecutablePatternRefusal(source: string): string | undefined {
  const parsed = parseShellWords(preserveShellCommandBoundaries(source), (name) => ({
    expansion: name,
  }));
  return executablePatternRefusal(parsed);
}

export function executablePatternRefusal(parsed: readonly ShellParseEntry[]): string | undefined {
  let words: Word[] = [];
  let redirectTarget = false;
  for (let index = 0; index < parsed.length; index += 1) {
    const entry = parsed[index];
    if (typeof entry === 'string') {
      if (redirectTarget) {
        redirectTarget = false;
        continue;
      }
      const next = parsed[index + 1];
      if (/^\d+$/.test(entry) && typeof next === 'object' && 'op' in next && /^[<>]/.test(next.op))
        continue;
      words.push(entry);
    } else if (entry && 'op' in entry) {
      if (entry.op === 'glob' && 'pattern' in entry) {
        if (redirectTarget) redirectTarget = false;
        else words.push({ op: 'glob', pattern: entry.pattern });
      } else if (['&&', '||', ';', '|', '&', '|&'].includes(entry.op)) {
        if (commandPattern(words)) return 'executable pathname expansion';
        words = [];
        redirectTarget = false;
      } else if (/^[<>]|^&>/.test(entry.op)) redirectTarget = true;
    }
  }
  return commandPattern(words) ? 'executable pathname expansion' : undefined;
}
