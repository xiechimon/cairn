import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const repo = JSON.parse(
  execFileSync('gh', ['api', 'repos/xiechimon/cairn'], { encoding: 'utf8' }),
);
assert.equal(repo.has_discussions, true, 'Discussions must be enabled');
const result = JSON.parse(
  execFileSync(
    'gh',
    [
      'api',
      'graphql',
      '-f',
      'query={repository(owner:"xiechimon",name:"cairn"){discussionCategories(first:30){nodes{id name slug isAnswerable}} discussions(first:30){nodes{title url body}}}}',
    ],
    { encoding: 'utf8' },
  ),
).data.repository;
assert.ok(
  result.discussionCategories.nodes.some((category) => category.name === 'Q&A' && category.isAnswerable),
  'Q&A category must accept answers',
);
assert.ok(
  result.discussions.nodes.some((discussion) => discussion.title === 'Welcome to Cairn Discussions'),
  'Welcome post must exist',
);
console.log(JSON.stringify({ enabled: repo.has_discussions, ...result }, null, 2));
