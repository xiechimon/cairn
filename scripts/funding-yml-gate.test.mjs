import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fundingHandle, fundingProblems, parseFunding } from './funding-yml-gate.mjs';

const path = '.github/FUNDING.yml';
const script = resolve('scripts/funding-yml-gate.mjs');

const repo = () => readFileSync(path, 'utf8');

test('#2002 the committed file is exactly a GitHub Sponsors account and passes the gate', () => {
  const parsed = parseFunding(repo());
  assert.deepEqual(fundingProblems(parsed), []);
  assert.deepEqual(parsed.funding, { github: ['xiechimon'] });
  assert.equal(fundingHandle(repo()), 'xiechimon');
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 0);
});

test('#2002 a file without a GitHub Sponsors account is rejected', () => {
  assert.deepEqual(fundingProblems(parseFunding('custom: [https://afdian.com/a/xiechimon]\n')), [
    'github: GitHub Sponsors account is required',
  ]);
  assert.deepEqual(fundingProblems(parseFunding('')), [
    'github: GitHub Sponsors account is required',
  ]);
});

test('#2002 duplicate keys are rejected instead of silently overwriting', () => {
  assert.deepEqual(fundingProblems(parseFunding('github: a\ngithub: b\n')), [
    'line 2: duplicate `github` key',
  ]);
  assert.deepEqual(parseFunding('github: a\ngithub: b\n').funding, { github: ['a'] });
});

test('#2002 a non-GitHub key, an empty key and a non-https custom link are rejected', () => {
  assert.deepEqual(
    fundingProblems(parseFunding('github: xiechimon\nafdian: https://afdian.com/a/xiechimon\n')),
    ['line 2: `afdian` is not a GitHub funding platform'],
  );
  assert.deepEqual(
    fundingProblems(parseFunding('github: xiechimon\ncustom: [http://afdian.com/a/xiechimon]\n')),
    ['custom: `http://afdian.com/a/xiechimon` is not an https URL'],
  );
  assert.deepEqual(fundingProblems(parseFunding('github:\n')), [
    'github: GitHub Sponsors account is required',
    'line 1: `github` has no value',
  ]);
});

test('#2002 block lists and inline lists read the same entries', () => {
  assert.deepEqual(parseFunding('custom:\n  - https://a.example/x\n  - https://b.example/y\n'), {
    funding: { custom: ['https://a.example/x', 'https://b.example/y'] },
    unknown: [],
  });
  assert.deepEqual(parseFunding('custom: [https://a.example/x, https://b.example/y]\n'), {
    funding: { custom: ['https://a.example/x', 'https://b.example/y'] },
    unknown: [],
  });
  assert.deepEqual(fundingProblems(parseFunding('github: [a, b]\n')), [
    'github: GitHub Sponsors accepts a single account',
  ]);
});
