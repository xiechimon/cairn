#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

export const BANNED_MODEL_IDS = Object.freeze(['deepseek-v4-flash', 'minimax-m3', 'gpt-6-astra']);

const AI_ROUTE_LINE = /^ai-route:\s+([A-Za-z0-9_-]+)\s+->\s+(\S+)\s*$/;

export function normalizeModelId(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*]/g, '');
}

export function isBannedModelId(raw) {
  const id = normalizeModelId(raw);
  if (!id) return false;
  if (BANNED_MODEL_IDS.includes(id)) return true;
  if (id.startsWith('gpt-5.6')) return true;
  return false;
}

export function parseModelRoles(markdown) {
  const lines = markdown.split(/\r?\n/);
  const heading = lines.indexOf('## Model roles');
  if (heading === -1) return [];
  const rows = [];
  for (const line of lines.slice(heading + 1)) {
    if (line.startsWith('## ')) break;
    if (!line.trim().startsWith('|')) continue;
    const [role, model] = line
      .trim()
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (!role || model === undefined) continue;
    if (role === 'Role' && model === 'Model') continue;
    if (/^:?-+:?$/.test(role) && /^:?-+:?$/.test(model)) continue;
    const modelIds = [...model.matchAll(/[a-z][a-z0-9.]*(?:-[a-z0-9.]+)+/gi)].map(
      (match) => match[0],
    );
    rows.push({ role, model, modelIds });
  }
  return rows;
}

export function modelIdFromRoute(route) {
  const trimmed = String(route ?? '').trim();
  if (!trimmed) return '';
  const slash = trimmed.lastIndexOf('/');
  if (slash >= 0) return normalizeModelId(trimmed.slice(slash + 1));
  const colon = trimmed.lastIndexOf(':');
  if (colon >= 0) return normalizeModelId(trimmed.slice(colon + 1));
  return normalizeModelId(trimmed);
}

export function parseAiRouteSelection(line) {
  const match = AI_ROUTE_LINE.exec((line ?? '').trim());
  if (!match) return null;
  const task = match[1];
  const route = match[2];
  return { task, route, modelId: modelIdFromRoute(route) };
}

export function bannedModelFromLog(log) {
  const lines = String(log ?? '').split(/\r?\n/);
  for (const line of lines) {
    const selection = parseAiRouteSelection(line);
    if (selection && isBannedModelId(selection.modelId)) return selection;
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sample = process.argv[2] ?? '';
  const hit = bannedModelFromLog(sample);
  if (hit) {
    console.error(`banned-model: ${hit.modelId} (task ${hit.task}, route ${hit.route})`);
    process.exit(1);
  }
  console.log('lane-model-policy: ok');
}
