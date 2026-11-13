import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { stripQuoted } from './english-only-gate.mjs';

const TITLE_TICKET = /^[\w+./-]+\(#?(\d+)\)!?:/;

export function ticketOf(title) {
  const match = TITLE_TICKET.exec(title);
  return match ? Number(match[1]) : null;
}

function links(text, ticket) {
  const issue = `#${ticket}(?!\\d)`;
  const closing = `(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\\s+${issue}`;
  return new RegExp(`(?<![\\w-])(?:${closing}|part of\\s+${issue})`, 'i').test(text);
}

export function ticketLinkProblem({ title, body, commits }) {
  const ticket = ticketOf(title);
  if (ticket === null) return null;
  if (links(stripQuoted(body), ticket) || links(commits, ticket)) return null;
  return [
    `The title names #${ticket}, but neither the PR body nor a commit message says`,
    `"Closes #${ticket}" (this PR finishes the ticket) or "Part of #${ticket}" (one segment of it).`,
    'Add that line to the PR body, outside code and HTML comments. GitHub closes the issue',
    'when the PR merges into main, whatever the merge method.',
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const { values } = parseArgs({
    options: {
      title: { type: 'string' },
      body: { type: 'string' },
      commits: { type: 'string' },
    },
  });
  if (values.title === undefined || values.body === undefined) {
    console.error('usage: pr-ticket-link.mjs --title <title> --body <file> [--commits <file>]');
    process.exit(2);
  }
  const problem = ticketLinkProblem({
    title: values.title,
    body: readFileSync(values.body, 'utf8'),
    commits: values.commits === undefined ? '' : readFileSync(values.commits, 'utf8'),
  });
  if (problem) {
    console.log(`pr-ticket-link: FAIL\n${problem}`);
    process.exit(1);
  }
  console.log('pr-ticket-link: ok');
}
