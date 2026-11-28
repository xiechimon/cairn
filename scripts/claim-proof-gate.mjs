#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_ROOT = resolve(import.meta.dirname, '..');
const REGISTRY_REL = 'docs/claims.json';
const FEATURE_MAP_REL = '.claude/skills/verify-cairn/feature-map.json';
const MARKER = /<!--\s*claim:\s*([a-z0-9-]+)\s*-->/g;
const BULLET = /^- /;
const HEADING = /^## /;
const COPY_ITEM = /^\s{8}\{/;

const COVERED_SECTIONS = [
  { file: 'README.md', heading: '## What you get' },
  { file: 'README.zh.md', heading: '## 你会得到什么' },
  {
    file: 'docs/spec/18-positioning-and-differentiation.md',
    heading: '### 1.1 Capabilities carried over from the 2026-11-01 thesis',
    item: /^> \d+\. /,
  },
];
const COPY_FILE = 'site/src/components/copy.ts';
const SCANNED_FILES = [
  'README.md',
  'README.zh.md',
  'docs/spec/18-positioning-and-differentiation.md',
  COPY_FILE,
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function markersIn(line) {
  return [...line.matchAll(MARKER)].map((match) => match[1]);
}

function textAt(file, line) {
  return `${file}:${line}`;
}

function sectionBullets(text, heading, itemPattern = BULLET) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && HEADING.test(line));
  const stop = end === -1 ? lines.length : end;
  const bullets = [];
  for (let index = start + 1; index < stop; index++) {
    if (itemPattern.test(lines[index])) bullets.push({ line: index + 1, text: lines[index] });
  }
  return bullets;
}

function pointRegions(lines) {
  const regions = [];
  for (let index = 0; index < lines.length; index++) {
    if (!/^ {4}points: \{/.test(lines[index])) continue;
    const end = lines.findIndex((line, later) => later > index && /^ {4}\},/.test(line));
    regions.push({ start: index, end: end === -1 ? lines.length : end });
  }
  return regions;
}

function allCopyBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let current = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (COPY_ITEM.test(line)) {
      if (current !== null) blocks.push(current);
      current = { line: index + 1, start: index };
    } else if (current !== null && /^\s{8}\},/.test(line)) {
      current.end = index;
      blocks.push(current);
      current = null;
    }
  }
  if (current !== null) blocks.push(current);
  return blocks.filter((block) => block.end !== undefined);
}

function pointsBlocks(text) {
  const lines = text.split('\n');
  const regions = pointRegions(lines);
  return allCopyBlocks(text).filter((block) =>
    regions.some((region) => block.start > region.start && block.start < region.end),
  );
}

function blockText(lines, block) {
  return lines.slice(block.start, block.end + 1).join('\n');
}

function localeOf(lines, block) {
  for (let index = block.start; index >= 0; index--) {
    const match = /^\s{2}([a-z]{2}):\s*\{/.exec(lines[index]);
    if (match) return match[1];
  }
  return null;
}

function pointItems(lines) {
  const seen = new Map();
  return pointsBlocks(lines.join('\n')).map((block) => {
    const locale = localeOf(lines, block);
    const count = (seen.get(locale) ?? 0) + 1;
    seen.set(locale, count);
    const label = locale ? `${locale} home point item #${count}` : `home point item #${count}`;
    return { block, label };
  });
}

export function checkClaims({ cwd = DEFAULT_ROOT } = {}) {
  const registryPath = resolve(cwd, REGISTRY_REL);
  const featurePath = resolve(cwd, FEATURE_MAP_REL);
  const failures = [];
  if (!existsSync(registryPath)) {
    for (const file of SCANNED_FILES) {
      const target = resolve(cwd, file);
      if (!existsSync(target)) continue;
      const lines = readFileSync(target, 'utf8').split('\n');
      for (let index = 0; index < lines.length; index++) {
        if (markersIn(lines[index]).length > 0) {
          failures.push(`${file}:${index + 1}: claim markers exist but ${REGISTRY_REL} is missing`);
        }
      }
    }
    const copyTarget = resolve(cwd, COPY_FILE);
    if (existsSync(copyTarget)) {
      const lines = readFileSync(copyTarget, 'utf8').split('\n');
      for (const { block, label } of pointItems(lines)) {
        const match = blockText(lines, block).match(/claim:\s*'([a-z0-9-]+)'/);
        if (match) {
          failures.push(
            `${COPY_FILE}:${block.line}: ${label} keeps claim '${match[1]}' but ${REGISTRY_REL} is missing`,
          );
        }
      }
    }
    return failures;
  }

  if (!existsSync(featurePath)) return [`${FEATURE_MAP_REL} is missing`];
  const registry = readJson(registryPath);
  const features = new Set(readJson(featurePath).features.map((feature) => feature.id));
  const claims = Array.isArray(registry.claims) ? registry.claims : [];

  const ids = new Set();
  for (const claim of claims) {
    if (!claim.id || !/^[a-z0-9-]+$/.test(claim.id)) {
      failures.push(`claim id is missing or malformed: ${JSON.stringify(claim.id)}`);
      continue;
    }
    if (ids.has(claim.id)) failures.push(`claim id is duplicated: ${claim.id}`);
    ids.add(claim.id);
    if (!Array.isArray(claim.proof) || claim.proof.length === 0) {
      failures.push(`claim ${claim.id} carries no proof pointer`);
    }
    for (const pointer of claim.proof ?? []) {
      if (pointer.startsWith('feature:')) {
        const id = pointer.slice('feature:'.length);
        if (!features.has(id)) failures.push(`claim ${claim.id}: unknown feature ${id}`);
        continue;
      }
      if (pointer.startsWith('test:')) {
        const path = pointer.slice('test:'.length);
        if (!existsSync(resolve(cwd, path)) || !path.includes('.test.'))
          failures.push(`claim ${claim.id}: test pointer does not resolve: ${path}`);
        continue;
      }
      if (!existsSync(resolve(cwd, pointer))) {
        failures.push(`claim ${claim.id}: pointer does not resolve: ${pointer}`);
      }
    }
    const anchors = Array.isArray(claim.anchors) ? claim.anchors : [];
    if (anchors.length === 0) failures.push(`claim ${claim.id} names no anchor`);
    for (const anchor of anchors) {
      const target = resolve(cwd, anchor.file);
      if (!existsSync(target)) {
        failures.push(`claim ${claim.id}: anchor file is missing: ${anchor.file}`);
        continue;
      }
      const text = readFileSync(target, 'utf8');
      if (anchor.file === COPY_FILE) {
        const lines = text.split('\n');
        const blocks = allCopyBlocks(lines.join('\n')).filter((block) =>
          blockText(lines, block).includes(`claim: '${claim.id}'`),
        );
        if (blocks.length === 0) {
          failures.push(`claim ${claim.id}: no copy item carries claim: '${claim.id}'`);
        } else if (!blocks.some((block) => blockText(lines, block).includes(anchor.text))) {
          failures.push(
            textAt(anchor.file, blocks[0].line) + `: no item for ${claim.id} says "${anchor.text}"`,
          );
        }
        continue;
      }
      const lines = text.split('\n');
      const index = lines.findIndex((line) => line.includes(anchor.text));
      if (index === -1) {
        failures.push(`${anchor.file}: anchor for ${claim.id} is gone: "${anchor.text}"`);
      } else if (!markersIn(lines[index]).includes(claim.id)) {
        failures.push(textAt(anchor.file, index + 1) + `: claim ${claim.id} has no marker`);
      }
    }
  }

  for (const section of COVERED_SECTIONS) {
    const target = resolve(cwd, section.file);
    if (!existsSync(target)) {
      failures.push(`${section.file} is missing`);
      continue;
    }
    const bullets = sectionBullets(
      readFileSync(target, 'utf8'),
      section.heading,
      section.item ?? BULLET,
    );
    if (bullets === null) {
      failures.push(`${section.file}: heading "${section.heading}" is missing`);
      continue;
    }
    for (const bullet of bullets) {
      const markers = markersIn(bullet.text);
      if (markers.length === 0) {
        failures.push(textAt(section.file, bullet.line) + ': claim line carries no proof marker');
        continue;
      }
      for (const marker of markers) {
        if (!ids.has(marker)) {
          failures.push(textAt(section.file, bullet.line) + `: unknown claim ${marker}`);
        }
      }
    }
  }

  const copyPath = resolve(cwd, COPY_FILE);
  if (!existsSync(copyPath)) {
    failures.push(`${COPY_FILE} is missing`);
  } else {
    const lines = readFileSync(copyPath, 'utf8').split('\n');
    for (const { block, label } of pointItems(lines)) {
      const body = blockText(lines, block);
      const match = body.match(/claim:\s*'([a-z0-9-]+)'/);
      if (!match) {
        failures.push(textAt(COPY_FILE, block.line) + `: ${label} carries no claim`);
        continue;
      }
      if (!ids.has(match[1])) {
        failures.push(textAt(COPY_FILE, block.line) + `: unknown claim ${match[1]}`);
      }
    }
  }

  for (const file of SCANNED_FILES) {
    const target = resolve(cwd, file);
    if (!existsSync(target)) continue;
    const lines = readFileSync(target, 'utf8').split('\n');
    for (let index = 0; index < lines.length; index++) {
      for (const marker of markersIn(lines[index])) {
        if (!ids.has(marker)) failures.push(textAt(file, index + 1) + `: unknown claim ${marker}`);
      }
    }
  }

  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const failures = checkClaims();
  if (failures.length > 0) {
    for (const failure of failures) console.error(`[claim-proof-gate] ${failure}`);
    console.error(
      `[claim-proof-gate] ${failures.length} failure(s); a capability claim lost its proof`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      '[claim-proof-gate] PASS: every capability claim points at a feature, file or test',
    );
  }
}
