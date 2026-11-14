import { homedir } from 'node:os';
import { cairnHostRefusal } from './guard-cairn.js';
import { executablePatternRefusal, shellExecutablePatternRefusal } from './guard-executable.js';
import {
  braceExpansionHazard,
  executesWrittenHeredoc,
  freshLiteralKey,
  heredocBodyHazard,
  isFileWriteRedirect,
  isHeredocDataSinkPipeline,
  isShellOrSourceCommand,
  nextHeredocCwd,
  normalizeWrittenPath,
  quotedHeredocBodyIsDynamic,
  readExpansion,
  readHeredocBody,
  readHeredocDelimiter,
  resolveExecutionPath,
  teeDestinationPaths,
} from './guard-heredoc.js';
import { BROWSER_STATE_PATHS, quotedHeredocLifecycleHazard } from './guard-quoted.js';
import { parseShellWords, preserveShellCommandBoundaries } from './guard-shell-parse.js';
import {
  assignmentEntries,
  commandBaseAt,
  commandBasename,
  commandWritesActivateScript,
  externalAssignments,
  isActivateWriteTarget,
  isLiteralActivatePath,
  isUnsafeSource,
  literalCommandToken,
  primaryCommandIndex,
  SAFE_SHELL_CONTROL_OPS,
  SHELL_INTERPRETER_NAMES,
  STATIC_SHELL_EXPANSIONS,
  unresolvedVariableReason,
} from './guard-words.js';

type ShellSeparator = 'pipe' | 'and' | 'or' | 'seq' | 'background';

type PreparedDesktopCommand =
  | { command: string; literals: Readonly<Record<string, string>> }
  | { reason: string };

type PendingHeredoc = {
  delimiter: string;
  quoted: boolean;
  stripTabs: boolean;
  names?: string[];
};

function prepareDesktopGuardCommand(source: string): PreparedDesktopCommand {
  const env = new Map<string, string>();
  const literals: Record<string, string> = {};
  const usedKeys = new Set<string>();
  const pending: PendingHeredoc[] = [];
  let heredocConsumed = false;
  let heredocDynamic = false;
  const heredocDir: { cwd: string | undefined } = { cwd: '' };
  const heredocOutputs = new Set<string>();
  const pipelineWrites: string[] = [];
  let pipelineHasHeredoc = false;
  const simpleWrites: string[] = [];
  let pipelineNames: string[] = [];
  let commandWords: string[] = [];
  let out = '';
  let rawWord = '';
  let quote: "'" | '"' | undefined;
  let wordQuoted = false;
  let atWordStart = true;
  let redirectNext = false;
  let redirectOp = '';
  let activateWrite = false;
  let substituteLiterals = true;
  let guaranteed = true;
  let inPipeline = false;
  let index = 0;

  const finishWord = () => {
    if (rawWord.length === 0 && !wordQuoted) return;
    const raw = rawWord;
    rawWord = '';
    wordQuoted = false;
    atWordStart = true;
    if (redirectNext) {
      redirectNext = false;
      if (isActivateWriteTarget(redirectOp, raw, commandWords, env)) activateWrite = true;
      const target = literalCommandToken(raw);
      if (target && isFileWriteRedirect(redirectOp, target)) {
        simpleWrites.push(normalizeWrittenPath(target));
      }
      redirectOp = '';
      return;
    }
    commandWords.push(raw);
  };

  const forgetExternalAssignments = (words: readonly string[]) => {
    const assigned = externalAssignments(words);
    if (!assigned) return;
    if (assigned.clear) {
      substituteLiterals = false;
      env.clear();
      return;
    }
    for (const name of assigned.names) {
      env.delete(name);
      if (name === 'IFS') substituteLiterals = false;
    }
  };

  const endSimple = (kind: ShellSeparator): string | undefined => {
    finishWord();
    const words = commandWords;
    commandWords = [];
    if (pipelineHasHeredoc) {
      const placed = (path: string) => resolveExecutionPath(heredocDir.cwd, path);
      for (const path of simpleWrites) {
        const resolved = placed(path);
        if (resolved !== undefined) pipelineWrites.push(resolved);
      }
      for (const path of teeDestinationPaths(words)) {
        const resolved = placed(path);
        if (resolved !== undefined) pipelineWrites.push(resolved);
      }
    }
    simpleWrites.length = 0;
    const commandIndex = primaryCommandIndex(words);
    if (
      kind !== 'pipe' &&
      kind !== 'background' &&
      !inPipeline &&
      commandIndex !== undefined &&
      commandBaseAt(words, commandIndex) === 'cd'
    ) {
      heredocDir.cwd = nextHeredocCwd(heredocDir.cwd, words.slice(commandIndex + 1));
    }
    if (activateWrite || commandWritesActivateScript(words, env)) activateWrite = true;
    if (activateWrite && pending.length === 0) return 'activate script';
    if (
      heredocConsumed &&
      (isShellOrSourceCommand(words) ||
        executesWrittenHeredoc(words, heredocOutputs, heredocDynamic, heredocDir))
    ) {
      return 'heredoc';
    }
    const guaranteedBefore = guaranteed;
    if (isUnsafeSource(words)) return 'source';
    const base = commandBasename(words);
    if (base !== undefined) pipelineNames.push(base);
    const entries = assignmentEntries(words);
    if (entries?.some((entry) => entry.name === 'IFS')) substituteLiterals = false;
    forgetExternalAssignments(words);
    const pipeMember = inPipeline || kind === 'pipe';
    if (!pipeMember && kind !== 'background') {
      if (entries) {
        for (const entry of entries) {
          if (!guaranteedBefore || entry.value === null) env.delete(entry.name);
          else env.set(entry.name, entry.value);
        }
      }
    } else if (kind === 'background') {
      for (const entry of entries ?? []) env.delete(entry.name);
    }
    if (kind === 'pipe') {
      inPipeline = true;
      guaranteed = false;
      return undefined;
    }
    for (const heredoc of pending) {
      if (!heredoc.names) heredoc.names = [...pipelineNames];
    }
    pipelineNames = [];
    inPipeline = false;
    if (kind === 'and') {
      const stable = assignmentEntries(words)?.every((entry) => entry.value !== null) ?? false;
      guaranteed = guaranteedBefore && stable && !pipeMember;
    } else if (kind === 'or' || kind === 'background') guaranteed = false;
    else guaranteed = true;
    if (pending.length === 0) {
      pipelineWrites.length = 0;
      pipelineHasHeredoc = false;
    }
    return undefined;
  };

  const appendExpansion = (): string | undefined => {
    const next = source[index + 1];
    if (next === '(') {
      return source[index + 2] === '(' ? 'arithmetic expansion' : 'command substitution';
    }
    const expansion = readExpansion(source, index);
    if (!expansion) {
      out += '$';
      rawWord += '$';
      index += 1;
      atWordStart = false;
      return undefined;
    }
    rawWord += expansion.raw;
    if (!expansion.simple) {
      const hazard = braceExpansionHazard(expansion.raw);
      if (hazard) return hazard;
      out += expansion.raw;
    } else {
      const value = env.get(expansion.name);
      if (value === undefined || !substituteLiterals) out += expansion.raw;
      else {
        const key = freshLiteralKey(source, usedKeys);
        literals[key] = value;
        out += `$${key}`;
      }
    }
    index = expansion.end;
    atWordStart = false;
    return undefined;
  };

  while (index < source.length) {
    const character = source[index];
    if (quote === "'") {
      out += character ?? '';
      rawWord += character ?? '';
      if (character === "'") quote = undefined;
      index += 1;
      continue;
    }
    if (quote === '"') {
      if (character === '\\') {
        const next = source[index + 1];
        out += character ?? '';
        rawWord += character ?? '';
        if (next !== undefined) {
          out += next;
          rawWord += next;
          index += 2;
          continue;
        }
      } else if (character === '"') {
        quote = undefined;
        out += character;
        rawWord += character;
      } else if (character === '`') return { reason: 'backtick' };
      else if (character === '$') {
        const reason = appendExpansion();
        if (reason) return { reason };
        continue;
      } else {
        out += character ?? '';
        rawWord += character ?? '';
      }
      index += 1;
      continue;
    }
    if (character === '\\') {
      const next = source[index + 1];
      if (next === '\n') {
        index += 2;
        continue;
      }
      out += '\\';
      rawWord += '\\';
      atWordStart = false;
      if (next !== undefined) {
        out += next;
        rawWord += next;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      wordQuoted = true;
      atWordStart = false;
      out += character;
      rawWord += character;
      index += 1;
      continue;
    }
    if (character === '#' && atWordStart) {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (character === '#') {
      out += '\\#';
      rawWord += '#';
      atWordStart = false;
      index += 1;
      continue;
    }
    if (character === ' ' || character === '\t') {
      finishWord();
      out += character;
      atWordStart = true;
      index += 1;
      continue;
    }
    if (character === '\n') {
      const separated = endSimple('seq');
      if (separated) return { reason: separated };
      if (pending.length === 0) {
        out += '\n';
        atWordStart = true;
        index += 1;
        continue;
      }
      if (pending.some((heredoc) => !isHeredocDataSinkPipeline(heredoc.names ?? []))) {
        return { reason: 'heredoc' };
      }
      let cursor = index + 1;
      for (const heredoc of pending) {
        const body = readHeredocBody(source, cursor, heredoc.delimiter, heredoc.stripTabs);
        if (!body) return { reason: 'heredoc' };
        if (heredoc.quoted) {
          if (quotedHeredocLifecycleHazard(body.content)) return { reason: 'heredoc' };
          if (quotedHeredocBodyIsDynamic(body.content)) heredocDynamic = true;
        } else {
          const hazard = heredocBodyHazard(body.content);
          if (hazard) return { reason: hazard };
          try {
            const pattern = shellExecutablePatternRefusal(body.content);
            if (pattern) return { reason: pattern };
          } catch {
            return { reason: 'uninspectable shell syntax' };
          }
          out += body.content;
        }
        cursor = body.end;
      }
      for (const path of pipelineWrites) heredocOutputs.add(path);
      pipelineWrites.length = 0;
      pipelineHasHeredoc = false;
      pending.length = 0;
      heredocConsumed = true;
      out += '\n';
      atWordStart = true;
      index = cursor;
      continue;
    }
    if (character === '<' && source.startsWith('<<<', index)) return { reason: 'herestring' };
    if (character === '<' && source[index + 1] === '<') {
      finishWord();
      let cursor = index + 2;
      const stripTabs = source[cursor] === '-';
      if (stripTabs) cursor += 1;
      const delimiter = readHeredocDelimiter(source, cursor);
      if (!delimiter) return { reason: 'heredoc' };
      pending.push({ delimiter: delimiter.delimiter, quoted: delimiter.quoted, stripTabs });
      pipelineHasHeredoc = true;
      index = delimiter.end;
      atWordStart = true;
      continue;
    }
    if ((character === '<' || character === '>') && source[index + 1] === '(') {
      return { reason: 'subshell' };
    }
    if (character === '`') return { reason: 'backtick' };
    if (character === '$') {
      const reason = appendExpansion();
      if (reason) return { reason };
      continue;
    }
    if (character === '(' || character === ')') return { reason: 'subshell' };
    if (
      character === '{' &&
      source[index + 1] !== '}' &&
      !(atWordStart && /[\s;|&]/.test(source[index + 1] ?? ''))
    ) {
      return { reason: 'brace expansion' };
    }
    const multi = ['&&', '||', ';;', '|&', '>>', '>&', '<&', '&>'].find((op) =>
      source.startsWith(op, index),
    );
    if (
      multi ||
      character === ';' ||
      character === '|' ||
      character === '&' ||
      character === '>' ||
      character === '<'
    ) {
      const op = multi ?? character ?? '';
      const redirect =
        op === '>' || op === '<' || op === '>>' || op === '>&' || op === '<&' || op === '&>';
      if (redirect && !wordQuoted && /^\d+$/.test(rawWord)) {
        rawWord = '';
        atWordStart = true;
      }
      if (redirect) {
        finishWord();
        out += op;
        atWordStart = true;
        redirectOp = op;
        redirectNext = true;
        index += op.length;
        continue;
      }
      if (redirectNext) finishWord();
      out += op;
      atWordStart = true;
      redirectNext = false;
      index += op.length;
      const kind: ShellSeparator =
        op === '|' || op === '|&'
          ? 'pipe'
          : op === '&&'
            ? 'and'
            : op === '||'
              ? 'or'
              : op === '&'
                ? 'background'
                : 'seq';
      const separated = endSimple(kind);
      if (separated) return { reason: separated };
      continue;
    }
    out += character ?? '';
    rawWord += character ?? '';
    atWordStart = false;
    index += 1;
  }

  const separated = endSimple('seq');
  if (separated) return { reason: separated };
  if (quote || pending.length > 0)
    return { reason: quote ? 'uninspectable shell syntax' : 'heredoc' };
  return { command: out, literals };
}

function shellCFlagProgram(words: readonly string[], interpreterIndex: number): string | undefined {
  for (let index = interpreterIndex + 1; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (word.startsWith('--command=')) return word.slice('--command='.length);
    if (word === '--command' || /^-[^-]*c/.test(word)) return words[index + 1];
  }
  return undefined;
}

function shellTokenReason(entry: object): string | undefined {
  if ('comment' in entry) return 'comment';
  if ('expansion' in entry && typeof entry.expansion === 'string') {
    const hazard = braceExpansionHazard(entry.expansion);
    return hazard ?? unresolvedVariableReason(entry.expansion);
  }
  if (!('op' in entry) || typeof entry.op !== 'string') return 'uninspectable shell syntax';
  if (entry.op === 'glob') return undefined;
  if (entry.op === '(' || entry.op === ')' || entry.op === '<(') return 'subshell';
  if (entry.op === '<<<') return 'herestring';
  if (SAFE_SHELL_CONTROL_OPS.has(entry.op)) return undefined;
  return 'unsupported shell syntax';
}

function tokenizeProtectedShellCommand(
  command: string,
  literals: Readonly<Record<string, string>>,
): { words: string[] } | { reason: string } {
  try {
    const separated = preserveShellCommandBoundaries(command);
    const parsed = parseShellWords(
      separated,
      (name) => literals[name] ?? STATIC_SHELL_EXPANSIONS[name] ?? { expansion: name },
    );
    const patternRefusal = executablePatternRefusal(parsed);
    if (patternRefusal) return { reason: patternRefusal };
    const words: string[] = [];
    let commandPosition = true;
    let redirectTarget = false;
    for (const [index, entry] of parsed.entries()) {
      if (typeof entry === 'string') {
        if (entry.includes('`')) return { reason: 'backtick' };
        const folded = entry.toLowerCase();
        words.push(entry === '.' && (!commandPosition || redirectTarget) ? './' : entry);
        if (redirectTarget) {
          redirectTarget = false;
          continue;
        }
        const next = parsed[index + 1];
        if (
          commandPosition &&
          /^\d+$/.test(folded) &&
          typeof next === 'object' &&
          next !== null &&
          'op' in next &&
          /^[<>]/.test(next.op)
        ) {
        } else if (commandPosition && /^(?:then|do|else)$/.test(folded)) {
          commandPosition = true;
        } else if (commandPosition && (folded === 'coproc' || folded === 'function')) {
          return { reason: folded };
        } else if (
          commandPosition &&
          (/^(?:command|builtin|exec|time|if|elif|while|until|!|\{)$/.test(folded) ||
            folded.startsWith('-') ||
            /^[a-z_][a-z0-9_]*=/.test(folded))
        ) {
        } else commandPosition = false;
        continue;
      }
      if (typeof entry !== 'object' || entry === null)
        return { reason: 'uninspectable shell syntax' };
      if (
        'op' in entry &&
        entry.op === 'glob' &&
        'pattern' in entry &&
        typeof entry.pattern === 'string'
      ) {
        words.push(entry.pattern);
        continue;
      }
      const reason = shellTokenReason(entry);
      if (reason) return { reason };
      if ('op' in entry && typeof entry.op === 'string' && SAFE_SHELL_CONTROL_OPS.has(entry.op)) {
        if (['&&', '||', ';', '|', '&'].includes(entry.op)) {
          commandPosition = true;
          redirectTarget = false;
        } else redirectTarget = true;
      }
    }
    return { words };
  } catch {
    return { reason: 'uninspectable shell syntax' };
  }
}

function protectedWordRefusal(
  words: readonly string[],
  cairnHostRules: boolean,
): string | undefined {
  for (const word of words) {
    const base = (word.split('/').at(-1) ?? '').toLowerCase();
    if (/^(?:kill|pkill|killall|xkill)$/.test(base)) return `protected command ${base}`;
  }
  const cairn = cairnHostRules ? cairnHostRefusal(words) : undefined;
  if (cairn) return cairn;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    const base = (word.split('/').at(-1) ?? '').toLowerCase();
    if (base !== 'eval' && base !== 'source' && word !== '.') continue;
    const next = words[index + 1];
    if ((word === 'source' || word === '.') && next && isLiteralActivatePath(next)) continue;
    return base === 'eval' ? 'eval' : 'source';
  }
  const service = words
    .map((word) => (word.split('/').at(-1) ?? '').toLowerCase())
    .find((word) => word === 'systemctl' || word === 'service');
  if (service) {
    const action = words.find((word) => /^(?:stop|restart|kill)$/.test(word.toLowerCase()));
    if (action) return `${service} ${action.toLowerCase()}`;
  }
  for (const word of words) {
    const folded = word.toLowerCase();
    if (BROWSER_STATE_PATHS.some((path) => folded.includes(path))) return 'browser profile path';
    if (/(?:\/tmp\/\.x11-unix|\/tmp\/\.x\d+-lock)/.test(folded)) return 'X11 path';
  }
  for (let index = 0; index < words.length; index += 1) {
    const name = (words[index]?.split('/').at(-1) ?? '').toLowerCase();
    if (!SHELL_INTERPRETER_NAMES.test(name)) continue;
    const program = shellCFlagProgram(words, index);
    if (!program) continue;
    const nested = lifecycleRefusal(program, cairnHostRules);
    if (nested) return nested;
  }
  return undefined;
}

function lifecycleRefusal(command: string, cairnHostRules: boolean): string | undefined {
  const prepared = prepareDesktopGuardCommand(command);
  if ('reason' in prepared) return prepared.reason;
  const tokenized = tokenizeProtectedShellCommand(prepared.command, prepared.literals);
  if ('reason' in tokenized) return tokenized.reason;
  return protectedWordRefusal(tokenized.words, cairnHostRules);
}

export function protectedComputerLifecycleRefusal(command: string): string | undefined {
  return lifecycleRefusal(command, true);
}

export function orbComputerProtectionRefusal(command: string): string | undefined {
  return lifecycleRefusal(command, false);
}

export function hostComputerRootRefusal(
  command: string,
  root: string | undefined,
): string | undefined {
  if (!root) return undefined;
  const home = homedir();
  const name = root.startsWith(`${home}/`) ? root.slice(home.length + 1) : root;
  const folded = command
    .replace(/['"\\]/g, '')
    .replace(/\/(?:\.\/)+/g, '/')
    .replace(/\/{2,}/g, '/');
  return folded.includes(name) ? 'agent computer path' : undefined;
}

export function isProtectedComputerLifecycleCommand(command: string): boolean {
  return protectedComputerLifecycleRefusal(command) !== undefined;
}

export function desktopProtectionGuardMessage(reason: string): string {
  const recovery =
    reason === 'heredoc'
      ? ' For ordinary file edits, use the file tools or python3 -c with a quoted script instead of an interpreter heredoc. This refusal does not indicate a filesystem permission error.'
      : reason === 'command substitution' || reason === 'backtick'
        ? " For HTTP authentication, use the client's auth support or python3 -c reading the saved command credential from os.environ. Never print credentials. No request ran, so this refusal does not indicate invalid credentials."
        : '';
  return `This command was not run: desktop-protection guard: ${reason}. Shell access is still available.${recovery} Do not stop or restart browser, desktop, cairn daemon, server or Orb processes.`;
}
