import type { DailyUsage, DailyUsageDay } from '@cairn/shared';
import { shiftDay } from '../usage/usage-model.js';

const MODELS = [
  { key: 'anthropic/claude-opus-5-5', name: 'Claude Opus 5.5', provider: 'Anthropic' },
  { key: 'openai-codex/gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'ChatGPT Codex' },
  { key: 'zhipu/glm-5.3', name: 'GLM-5.3', provider: 'Zhipu' },
  { key: 'claude-code/claude-haiku-5-5', name: 'claude-haiku-5-5', provider: 'Claude Code' },
];

const PROJECTS = [
  { id: 'p-cairn', name: 'cairn' },
  { id: 'p-site', name: 'site' },
  { id: 'p-docs', name: 'docs-bot' },
];

export function usageFixture(today: string, count = 90): DailyUsage {
  let seed = 20261116;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const days: DailyUsageDay[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const ramp = 0.35 + 0.65 * (1 - back / count);
    const skip = next() < 0.18;
    const coordinator = Math.round((0.12 + next() * 1.5) * 1e6 * ramp);
    const tasks = next() < 0.2 ? 0 : Math.round(next() * next() * 3.4e6 * ramp);
    if (skip) continue;
    const total = coordinator + tasks;
    const cacheRead = Math.round(total * 0.8);
    const output = Math.round(total * 0.05);
    const cacheWrite = Math.round(total * 0.04);
    const opus = Math.round(coordinator * 0.85 + tasks * 0.45);
    const gpt = Math.round(tasks * 0.35);
    const glm = Math.round(tasks * 0.2);
    const cairn = Math.round(tasks * 0.6);
    const site = Math.round(tasks * 0.28);
    days.push({
      date: shiftDay(today, -back),
      coordinator,
      tasks,
      input: total - cacheRead - output - cacheWrite,
      output,
      cacheRead,
      cacheWrite,
      models: Object.fromEntries(
        [
          [MODELS[0]?.key, opus],
          [MODELS[1]?.key, gpt],
          [MODELS[2]?.key, glm],
          [MODELS[3]?.key, total - opus - gpt - glm],
        ].filter(([, v]) => (v as number) > 0),
      ),
      projects:
        tasks === 0 ? {} : { 'p-cairn': cairn, 'p-site': site, 'p-docs': tasks - cairn - site },
      todos: tasks === 0 ? [] : [`todo-${back}`, `todo-${back}-b`].slice(0, tasks > 1e6 ? 2 : 1),
      cost: null,
    });
  }
  return { days, models: MODELS, projects: PROJECTS };
}
