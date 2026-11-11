import type { AgentTodoItem } from '@cairn/shared';
import { Lexer, Marked, type Token, type Tokens } from 'marked';
import markedCjkFriendly from 'marked-cjk-friendly';
import type { DocSegment } from '../fixtures/records.js';
import { ATTACHMENT_LINE } from '../overlay/attachment-paste.js';

export type TableAlign = 'left' | 'center' | 'right' | null;
export type TaskState = AgentTodoItem['state'];
export type TaskItem = { state: TaskState; segments: DocSegment[]; blocks: ChatBlock[] };
export type ListItem = { checked: boolean | null; blocks: ChatBlock[] };

export type ChatBlock =
  | { kind: 'para'; segments: DocSegment[] }
  | { kind: 'head'; level: number; segments: DocSegment[] }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'tasks'; items: TaskItem[] }
  | { kind: 'quote'; blocks: ChatBlock[] }
  | { kind: 'code'; lang?: string; text: string }
  | { kind: 'attachment'; name: string; key: string }
  | { kind: 'rule' }
  | {
      kind: 'table';
      header: DocSegment[][];
      align: TableAlign[];
      rows: DocSegment[][][];
    };

export interface ChatBubbleGroup {
  bubble: boolean;
  blocks: ChatBlock[];
  source: string;
}

const md = new Marked({ gfm: true, breaks: true }, markedCjkFriendly());

const MENTION_TARGET = /^(agent|skill|project|machine|todo):([A-Za-z0-9_-]+)$/;
const WEB_TARGET = /^https?:\/\/\S+$/;
const ATTACHMENT_TARGET = /^attachment:([A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z0-9]{1,8})$/;
const AGENT_PROGRESS = /^\[([~/])\]\s+/;
const ITEM_MARKER = /^\[[ xX~/]\]\s+/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP_CELL = /^:?-{1,}:?$/;

type Flags = { strong: boolean; em: boolean; del: boolean };
const PLAIN: Flags = { strong: false, em: false, del: false };

function splitTableCells(line: string): string[] {
  const parts = line.trim().split('|');
  if (parts[0]?.trim() === '') parts.shift();
  if (parts.length > 0 && parts[parts.length - 1]?.trim() === '') parts.pop();
  return parts.map((part) => part.trim());
}

export function expandCollapsedTableLine(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('||') || !TABLE_ROW.test(trimmed)) return null;
  const expanded = trimmed.replace(/\|\|/g, '|\n|').split('\n');
  const parsed = expanded.map(splitTableCells);
  const sepIdx = parsed.findIndex(
    (cells) => cells.length > 0 && cells.every((cell) => TABLE_SEP_CELL.test(cell)),
  );
  if (sepIdx < 1) return null;
  const cols = parsed[sepIdx]?.length ?? 0;
  if (cols === 0 || !parsed.every((row) => row.length === cols)) return null;
  return expanded;
}

function normalizeSource(text: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (fence !== null) {
      out.push(line);
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length)
        fence = null;
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      out.push(line);
      continue;
    }
    if (ATTACHMENT_LINE.test(line)) {
      out.push('', line.trim(), '');
      continue;
    }
    out.push(...(expandCollapsedTableLine(line) ?? [line]));
  }
  return out.join('\n');
}

function plainText(tokens: Token[] | undefined): string {
  return (tokens ?? [])
    .map((token) => {
      if (token.type === 'br') return ' ';
      if ('tokens' in token && Array.isArray(token.tokens) && token.tokens.length > 0)
        return plainText(token.tokens);
      return 'text' in token && typeof token.text === 'string' ? token.text : token.raw;
    })
    .join('');
}

function textSegment(text: string, flags: Flags): DocSegment {
  const seg: DocSegment = flags.strong ? { text, style: 'strong' } : { text };
  if (flags.em) seg.em = true;
  if (flags.del) seg.del = true;
  return seg;
}

function withFlags(seg: DocSegment, flags: Flags): DocSegment {
  if (flags.strong) seg.strong = true;
  if (flags.em) seg.em = true;
  if (flags.del) seg.del = true;
  return seg;
}

function linkSegment(target: string, label: string, raw: string, flags: Flags): DocSegment {
  const mention = MENTION_TARGET.exec(target);
  if (mention !== null && label !== '')
    return {
      text: label,
      style: 'mention',
      mentionKind: mention[1] as NonNullable<DocSegment['mentionKind']>,
      mentionId: mention[2] ?? '',
    };
  const attachment = ATTACHMENT_TARGET.exec(target);
  if (attachment !== null) {
    const key = attachment[1] ?? '';
    return withFlags(
      {
        text: label !== '' ? label : key.slice(key.lastIndexOf('/') + 1),
        style: 'attachment',
        attachmentKey: key,
      },
      flags,
    );
  }
  if (WEB_TARGET.test(target))
    return withFlags({ text: label !== '' ? label : target, style: 'anchor', href: target }, flags);
  return textSegment(raw, flags);
}

function collectSegments(tokens: Token[], flags: Flags, out: DocSegment[]): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'strong':
        collectSegments((token as Tokens.Strong).tokens, { ...flags, strong: true }, out);
        break;
      case 'em':
        collectSegments((token as Tokens.Em).tokens, { ...flags, em: true }, out);
        break;
      case 'del':
        collectSegments((token as Tokens.Del).tokens, { ...flags, del: true }, out);
        break;
      case 'codespan':
        out.push({ text: (token as Tokens.Codespan).text, style: 'code' });
        break;
      case 'br':
        out.push({ text: '\n', style: 'break' });
        break;
      case 'link': {
        const link = token as Tokens.Link;
        out.push(linkSegment(link.href, plainText(link.tokens), link.raw, flags));
        break;
      }
      case 'image': {
        const image = token as Tokens.Image;
        out.push(linkSegment(image.href, image.text, image.raw, flags));
        break;
      }
      case 'text': {
        const text = token as Tokens.Text;
        if (text.tokens !== undefined && text.tokens.length > 0)
          collectSegments(text.tokens, flags, out);
        else out.push(textSegment(text.text, flags));
        break;
      }
      case 'escape':
        out.push(textSegment((token as Tokens.Escape).text, flags));
        break;
      default:
        out.push(textSegment(token.raw, flags));
    }
  }
}

function mergeText(segments: DocSegment[]): DocSegment[] {
  const out: DocSegment[] = [];
  for (const seg of segments) {
    const last = out.at(-1);
    const plainRun = (s: DocSegment) =>
      (s.style === undefined || s.style === 'strong') && s.href === undefined;
    if (
      last !== undefined &&
      plainRun(last) &&
      plainRun(seg) &&
      last.style === seg.style &&
      last.em === seg.em &&
      last.del === seg.del
    ) {
      last.text += seg.text;
      continue;
    }
    out.push({ ...seg });
  }
  return out.filter((seg) => seg.text !== '' || seg.style === 'break');
}

function segmentsOf(tokens: Token[] | undefined): DocSegment[] {
  const out: DocSegment[] = [];
  collectSegments(tokens ?? [], PLAIN, out);
  return mergeText(out);
}

export function inlineSegments(text: string): DocSegment[] {
  const segments = segmentsOf(Lexer.lexInline(text, md.defaults));
  return segments.length > 0 ? segments : [{ text }];
}

function attachmentOf(paragraph: Tokens.Paragraph): ChatBlock | null {
  const [only, ...rest] = paragraph.tokens.filter(
    (token) => !(token.type === 'text' && token.raw.trim() === ''),
  );
  if (only === undefined || rest.length > 0 || only.type !== 'image') return null;
  const target = ATTACHMENT_TARGET.exec((only as Tokens.Image).href);
  if (target === null) return null;
  return { kind: 'attachment', name: (only as Tokens.Image).text, key: target[1] ?? '' };
}

function itemHead(item: Tokens.ListItem): Token | undefined {
  return item.tokens.find((token) => token.type === 'text' || token.type === 'paragraph');
}

function progressMarker(item: Tokens.ListItem): RegExpExecArray | null {
  return AGENT_PROGRESS.exec(itemHead(item)?.raw ?? '');
}

function agentTaskItem(item: Tokens.ListItem): TaskItem {
  const head = itemHead(item);
  const marker = progressMarker(item);
  const segments = segmentsOf(
    head !== undefined && 'tokens' in head ? (head.tokens as Token[]) : [],
  );
  const first = segments[0];
  if (first !== undefined) first.text = first.text.replace(ITEM_MARKER, '');
  const state: TaskState = marker !== null ? 'doing' : item.checked === true ? 'done' : 'todo';
  const rest = item.tokens.filter((token) => token !== head && token.type !== 'checkbox');
  return { state, segments: segments.filter((seg) => seg.text !== ''), blocks: blocksOf(rest) };
}

function itemBlocks(item: Tokens.ListItem): ChatBlock[] {
  const blocks = blocksOf(item.tokens.filter((t) => t.type !== 'checkbox'));
  const first = blocks[0];
  const lead = first?.kind === 'para' ? first.segments[0] : undefined;
  if (item.task && lead !== undefined) lead.text = lead.text.replace(ITEM_MARKER, '');
  return blocks;
}

function listBlocks(list: Tokens.List): ChatBlock[] {
  const runs: { tasks: boolean; items: Tokens.ListItem[]; start: number }[] = [];
  const base = typeof list.start === 'number' ? list.start : 1;
  list.items.forEach((item, index) => {
    const tasks = item.task || progressMarker(item) !== null;
    const open = runs.at(-1);
    if (open !== undefined && open.tasks === tasks) open.items.push(item);
    else runs.push({ tasks, items: [item], start: base + index });
  });
  return runs.map((run) =>
    run.tasks && run.items.some((item) => progressMarker(item) !== null)
      ? { kind: 'tasks', items: run.items.map(agentTaskItem) }
      : {
          kind: 'list',
          ordered: list.ordered,
          start: run.start,
          items: run.items.map((item) => ({
            checked: item.task ? item.checked === true : null,
            blocks: itemBlocks(item),
          })),
        },
  );
}

function blocksOf(tokens: Token[]): ChatBlock[] {
  return tokens.flatMap(blockOf);
}

function blockOf(token: Token): ChatBlock[] {
  switch (token.type) {
    case 'paragraph':
      return [
        attachmentOf(token as Tokens.Paragraph) ?? {
          kind: 'para',
          segments: segmentsOf((token as Tokens.Paragraph).tokens),
        },
      ];
    case 'text': {
      const text = token as Tokens.Text;
      return [
        {
          kind: 'para',
          segments: text.tokens !== undefined ? segmentsOf(text.tokens) : [{ text: text.text }],
        },
      ];
    }
    case 'heading':
      return [
        {
          kind: 'head',
          level: (token as Tokens.Heading).depth,
          segments: segmentsOf((token as Tokens.Heading).tokens),
        },
      ];
    case 'code': {
      const code = token as Tokens.Code;
      const lang = code.lang?.trim().split(/\s+/)[0] ?? '';
      return [{ kind: 'code', ...(lang !== '' ? { lang } : {}), text: code.text }];
    }
    case 'blockquote':
      return [{ kind: 'quote', blocks: blocksOf((token as Tokens.Blockquote).tokens) }];
    case 'list':
      return listBlocks(token as Tokens.List);
    case 'table': {
      const table = token as Tokens.Table;
      return [
        {
          kind: 'table',
          header: table.header.map((cell) => segmentsOf(cell.tokens)),
          align: table.align,
          rows: table.rows.map((row) => row.map((cell) => segmentsOf(cell.tokens))),
        },
      ];
    }
    case 'hr':
      return [{ kind: 'rule' }];
    case 'space':
    case 'def':
      return [];
    case 'html':
      return [{ kind: 'para', segments: [{ text: token.raw.trim() }] }];
    default:
      return [{ kind: 'para', segments: [{ text: token.raw }] }];
  }
}

interface TopBlock {
  block: ChatBlock;
  spaced: boolean;
  source: string;
}

function topBlocks(text: string): TopBlock[] {
  const out: TopBlock[] = [];
  let spaced = false;
  for (const token of md.lexer(normalizeSource(text))) {
    if (token.type === 'space') {
      spaced = true;
      continue;
    }
    blockOf(token).forEach((block, n) => {
      out.push({ block, spaced: spaced && n === 0, source: token.raw.trim() });
    });
    spaced = /\n\s*\n\s*$/.test(token.raw);
  }
  return out;
}

export function parseChatMarkdown(text: string): ChatBlock[] {
  return topBlocks(text).map((top) => top.block);
}

const UNBUBBLED = new Set<ChatBlock['kind']>(['code', 'table', 'attachment', 'tasks', 'rule']);

export function chatBubbleGroups(text: string): ChatBubbleGroup[] {
  const groups: ChatBubbleGroup[] = [];
  for (const { block, spaced, source } of topBlocks(text)) {
    const bubble = !UNBUBBLED.has(block.kind);
    const open = groups.at(-1);
    const joins =
      bubble &&
      open?.bubble === true &&
      (!spaced || (block.kind === 'list' && open.blocks.at(-1)?.kind === 'list'));
    if (open !== undefined && joins) {
      open.blocks.push(block);
      open.source = `${open.source}\n${source}`;
      continue;
    }
    groups.push({ bubble, blocks: [block], source });
  }
  return groups;
}
