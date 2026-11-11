import { chiefThread, chiefWorking } from './chief.js';
import type { ChiefContent, ChiefStreamItem, FixtureSet } from './records.js';

const working = chiefWorking.chief as ChiefContent;
const workingStream = (working.stream ?? []).filter((item) => item.kind !== 'streaming');
const settled = chiefThread.chief as ChiefContent;

function withTool(tool: string): FixtureSet {
  return { ...chiefWorking, chief: { ...working, runningTool: tool } };
}

function withLive(item: ChiefStreamItem): FixtureSet {
  return { ...chiefWorking, chief: { ...working, stream: [...workingStream, item] } };
}

export const CHIEF_MARK_SCENARIOS: Record<string, FixtureSet> = {
  'chief-mark-look': withTool('projects'),
  'chief-mark-run': withTool('bash'),
  'chief-mark-task': withTool('create_todo'),
  'chief-mark-offline': withLive({
    kind: 'streaming',
    seconds: 40,
    label: '排队中：等 {machine} 上线（前面 {ahead} 个）',
    labelVars: { machine: 'studio-mac', ahead: 0 },
  }),
  'chief-mark-error': {
    ...chiefThread,
    chief: {
      ...settled,
      stream: [
        ...(settled.stream ?? []),
        { kind: 'user', text: '再把 CONTRIBUTING.md 的验收部分补全' },
        { kind: 'error', text: '模型服务暂时不可用，这一轮没有完成。' },
      ],
    },
  },
};
