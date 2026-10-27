export const REFERENCE_FILES: Record<string, Record<string, string>> = {
  slugify: {
    'lib/slug.mjs': `export const slugify = (value) => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join('-');`,
  },
  'iso8601-duration': {
    'lib/duration.mjs': `export function parseDuration(text) {
  const parts = /^P(?:(\\d+)D)?(?:T(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?)?$/.exec(text);
  if (!parts || !parts.slice(1).some(Boolean) || text.endsWith('T')) return null;
  return parts.slice(1).reduce((sum, value, index) => sum + Number(value || 0) * [86400, 3600, 60, 1][index], 0);
}`,
  },
  'lru-cache': {
    'lib/lru-cache.mjs': `export class LruCache {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('capacity');
    this.capacity = capacity;
    this.entries = new Map();
  }
  get(key) {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key);
    this.put(key, value);
    return value;
  }
  put(key, value) {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value);
  }
  has(key) { return this.entries.has(key); }
  keys() { return [...this.entries.keys()].reverse(); }
}`,
  },
  'csv-fields': {
    'lib/csv.mjs': `export function splitCsvLine(line) {
  const fields = [];
  let index = 0;
  while (true) {
    let value = '';
    if (line[index] === '"') {
      index++;
      let closed = false;
      while (index < line.length) {
        const char = line[index++];
        if (char !== '"') value += char;
        else if (line[index] === '"') { value += '"'; index++; }
        else { closed = true; break; }
      }
      if (!closed || (index < line.length && line[index] !== ',')) return null;
    } else {
      while (index < line.length && line[index] !== ',') {
        if (line[index] === '"') return null;
        value += line[index++];
      }
    }
    fields.push(value);
    if (index === line.length) return fields;
    index++;
  }
}`,
  },
  'date-overlap': {
    'lib/overlap.mjs': `export function overlapDays(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, (Math.min(Date.parse(aEnd), Date.parse(bEnd)) - Math.max(Date.parse(aStart), Date.parse(bStart))) / 86400000);
}`,
  },
  'roman-numerals': {
    'lib/roman.mjs': `export function romanToInt(s) {
  const numerals = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  for (let number = 1; number <= 3999; number++) {
    let remaining = number;
    let encoded = '';
    for (const [value, symbol] of numerals) while (remaining >= value) { encoded += symbol; remaining -= value; }
    if (encoded === s) return number;
  }
  return null;
}`,
  },
  'render-template': {
    'lib/template.mjs': `export function render(template, vars) {
  return template.replace(/{{([A-Za-z0-9_]+)(?:\\|([A-Za-z0-9_]+))?}}/g, (_, key, filter) => {
    const value = Object.hasOwn(vars, key) ? String(vars[key]) : '';
    return filter === 'upper' ? value.toUpperCase() : filter === 'lower' ? value.toLowerCase() : value;
  });
}`,
  },
  'word-wrap': {
    'lib/wrap.mjs': `export function wrapText(text, width) {
  if (!Number.isInteger(width) || width < 1) throw new RangeError('width');
  return text.split('\\n').map((line) => {
    const output = [];
    let current = '';
    for (const word of line.split(/ +/).filter(Boolean)) {
      if (current && current.length + 1 + word.length > width) { output.push(current); current = ''; }
      current += (current ? ' ' : '') + word;
    }
    output.push(current);
    return output.join('\\n');
  }).join('\\n');
}`,
  },
  'merge-intervals': {
    'lib/intervals.mjs': `export function mergeIntervals(intervals) {
  const output = [];
  for (const [start, end] of intervals.toSorted((a,b) => a[0]-b[0])) {
    if (start > end) throw new RangeError('interval');
    const last = output.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else output.push([start, end]);
  }
  return output;
}`,
  },
  'parse-mode': {
    'lib/mode.mjs': `export function parseModeString(s) {
  if (s.length !== 9) return null;
  let result = 0;
  for (let i = 0; i < 9; i++) {
    if (s[i] !== '-' && s[i] !== 'rwx'[i % 3]) return null;
    result = result * 2 + Number(s[i] !== '-');
  }
  return result;
}`,
  },
  'topo-sort': {
    'lib/topo.mjs': `export function topoSort(nodes, edges) {
  const remaining = new Set(nodes);
  if (remaining.size !== nodes.length) throw new Error('duplicate');
  if (edges.some(([a,b]) => !remaining.has(a) || !remaining.has(b))) throw new Error('unknown');
  const result = [];
  while (remaining.size) {
    const next = [...remaining].sort().find((node) => !edges.some(([a,b]) => b === node && remaining.has(a)));
    if (next === undefined) return null;
    result.push(next);
    remaining.delete(next);
  }
  return result;
}`,
  },
  'json-path': {
    'lib/json-path.mjs': `export function getPath(obj, path) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\\[\\d+\\])*(?:\\.[A-Za-z_][A-Za-z0-9_]*(?:\\[\\d+\\])*)*$/.test(path)) return null;
  const tokens = path.match(/[A-Za-z_][A-Za-z0-9_]*|\\[\\d+\\]/g);
  let value = obj;
  for (const token of tokens) {
    if (token.startsWith('[')) value = Array.isArray(value) ? value[Number(token.slice(1,-1))] : undefined;
    else value = value == null ? undefined : value[token];
  }
  return value;
}`,
  },
  'array-diff': {
    'lib/array-diff.mjs': `export function diffArrays(oldArr, newArr) {
  const unmatched = [...oldArr];
  const added = [];
  for (const item of newArr) {
    const index = unmatched.indexOf(item);
    if (index < 0) added.push(item);
    else unmatched.splice(index, 1);
  }
  return { added, removed: unmatched };
}`,
  },
  'run-length': {
    'lib/rle.mjs': `export function rleEncode(text) {
  const pairs = [];
  for (const char of text) {
    const last = pairs.at(-1);
    if (last && last[0] === char) last[1]++;
    else pairs.push([char, 1]);
  }
  return pairs;
}`,
    'lib/rle-decode.mjs': `export function rleDecode(pairs) {
  return pairs.map(([char, count]) => {
    if (!Number.isInteger(count) || count < 1) throw new RangeError('count');
    return char.repeat(count);
  }).join('');
}`,
  },
  'day-of-year': {
    'lib/leap.mjs': `export const isLeapYear = (year) => year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);`,
    'lib/day-of-year.mjs': `import { isLeapYear } from './leap.mjs';
export function dayOfYear(text) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const months = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > months[month-1]) return null;
  return months.slice(0, month-1).reduce((a,b) => a+b, day);
}`,
  },
  'split-bill': {
    'lib/split-bill.mjs': `export function splitBill(totalCents, people) {
  if (!Number.isInteger(totalCents) || totalCents < 0 || !Number.isInteger(people) || people < 1) throw new RangeError('arguments');
  return Array.from({length: people}, (_, index) => Math.floor(totalCents / people) + Number(index < totalCents % people));
}`,
  },
  'priority-queue': {
    'lib/priority-queue.mjs': `export class MinPriorityQueue {
  entries = [];
  push(value, priority) {
    if (typeof priority !== 'number' || Number.isNaN(priority)) throw new TypeError('priority');
    this.entries.push({value, priority});
    this.entries.sort((a,b) => a.priority-b.priority);
  }
  peek() {
    if (!this.entries.length) throw new Error('empty');
    return this.entries[0].value;
  }
  pop() { const value = this.peek(); this.entries.shift(); return value; }
  get size() { return this.entries.length; }
}`,
  },
  'markdown-outline': {
    'lib/outline.mjs': `export function outline(markdown) {
  const headings = [];
  let fence = null;
  for (const line of markdown.split('\\n')) {
    const marker = /^ {0,3}(\`\`\`|~~~)/.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker; else if (fence === marker) fence = null; continue; }
    if (fence) continue;
    const match = /^ {0,3}(#{1,6}) (.*)$/.exec(line);
    if (match) headings.push({level: match[1].length, text: match[2].trim()});
  }
  return headings;
}`,
  },
  isbn: {
    'lib/isbn.mjs': `export function isValidIsbn10(s) {
  const digits = s.replace(/[- ]/g, '');
  return /^\\d{9}[\\dX]$/.test(digits) && [...digits].reduce((sum, char, index) => sum + (char === 'X' ? 10 : Number(char)) * (10-index), 0) % 11 === 0;
}`,
    'lib/isbn13.mjs': `export function isValidIsbn13(s) {
  const digits = s.replace(/[- ]/g, '');
  return /^\\d{13}$/.test(digits) && [...digits].reduce((sum, char, index) => sum + Number(char) * (index % 2 ? 3 : 1), 0) % 10 === 0;
}`,
  },
  pluralize: {
    'lib/plural.mjs': `export function pluralize(word, count, pluralForm) {
  if (count === 1) return word;
  if (pluralForm !== undefined) return pluralForm;
  const singular = ['child','person','goose','mouse','foot','tooth'];
  const index = singular.indexOf(word.toLowerCase());
  if (index >= 0) return ['children','people','geese','mice','feet','teeth'][index];
  if (/(s|x|z|ch|sh)$/.test(word)) return word + 'es';
  if (/[^aeiou]y$/.test(word)) return word.slice(0,-1) + 'ies';
  return word + 's';
}`,
  },
  'matrix-transpose': {
    'lib/transpose.mjs': `export function transpose(matrix) {
  if (!matrix.length) return [];
  if (matrix.some((row) => row.length !== matrix[0].length)) throw new Error('ragged');
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}`,
  },
};
