#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PATH = '.github/FUNDING.yml';
const KEYS = [
  'github',
  'patreon',
  'open_collective',
  'ko_fi',
  'tidelift',
  'community_bridge',
  'liberapay',
  'issuehunt',
  'lfx_crowdfunding',
  'polar',
  'buy_me_a_coffee',
  'thanks_dev',
  'custom',
];

export function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length > 1 && /^(['"]).*\1$/.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed;
}

export function parseFunding(text) {
  const funding = {};
  const unknown = [];
  const lines = text.split('\n');
  let index = 0;
  while (index < lines.length) {
    const text_ = lines[index];
    const entry = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(text_);
    if (/^\s*$/.test(text_) || /^\s*#/.test(text_)) {
      index++;
      continue;
    }
    if (!entry) {
      unknown.push({ line: index + 1, reason: 'line is not a `key: value` entry' });
      index++;
      continue;
    }
    const [, key, rest] = entry;
    const line = index + 1;
    const value = rest.trim();
    let entries = [];
    if (!value) {
      index++;
      while (index < lines.length && (/^\s*$/.test(lines[index]) || /^\s*-/.test(lines[index]))) {
        const item = /^\s*-(.*)$/.exec(lines[index]);
        const listed = item ? unquote(item[1]) : '';
        if (listed) entries.push(listed);
        index++;
      }
    } else {
      index++;
      entries = value.startsWith('[')
        ? unquote(value)
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map(unquote)
            .filter(Boolean)
        : [unquote(value)];
    }
    if (!KEYS.includes(key)) {
      unknown.push({ line, reason: `\`${key}\` is not a GitHub funding platform` });
      continue;
    }
    if (entries.length === 0) {
      unknown.push({ line, reason: `\`${key}\` has no value` });
      continue;
    }
    if (key in funding) {
      unknown.push({ line, reason: `duplicate \`${key}\` key` });
      continue;
    }
    funding[key] = entries;
  }
  return { funding, unknown };
}

export function fundingProblems({ funding, unknown }) {
  const problems = [];
  if (!funding.github) problems.push('github: GitHub Sponsors account is required');
  problems.push(...unknown.map((entry) => `line ${entry.line}: ${entry.reason}`));
  const github = funding.github ?? [];
  for (const handle of github)
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(handle))
      problems.push(`github: \`${handle}\` is not a GitHub login`);
  if (github.length > 1) problems.push('github: GitHub Sponsors accepts a single account');
  for (const [key, entries] of Object.entries(funding))
    if (key !== 'github' && key !== 'custom' && entries.length > 1)
      problems.push(`${key}: accepts a single account, found ${entries.length}`);
  for (const url of funding.custom ?? [])
    if (!/^https:\/\/[^\s]+$/.test(url)) problems.push(`custom: \`${url}\` is not an https URL`);
  return problems;
}

export function fundingHandle(text) {
  return parseFunding(text).funding.github?.[0] ?? null;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  if (!existsSync(PATH)) {
    console.error(`funding-yml-gate: ${PATH} is missing`);
    process.exitCode = 1;
  } else {
    const problems = fundingProblems(parseFunding(readFileSync(PATH, 'utf8')));
    for (const problem of problems) console.error(`funding-yml-gate: ${PATH}: ${problem}`);
    console.log(`funding-yml-gate: ${problems.length} problem(s)`);
    process.exitCode = problems.length ? 1 : 0;
  }
}
