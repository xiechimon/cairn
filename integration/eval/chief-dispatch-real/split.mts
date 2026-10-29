import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SecretBox } from '@cairn/shared';
import type { EvalFlowFile, LabeledDispatchCase } from './types.mts';

function caseBucket(caseId: string): number {
  const digest = createHash('sha256').update(caseId).digest();
  return digest.readUInt32BE(0);
}

export function splitLabeledCases(cases: LabeledDispatchCase[]): {
  visible: LabeledDispatchCase[];
  heldOut: LabeledDispatchCase[];
} {
  const sorted = [...cases].sort((a, b) => a.id.localeCompare(b.id));
  const visible: LabeledDispatchCase[] = [];
  const heldOut: LabeledDispatchCase[] = [];
  for (const c of sorted) {
    if (caseBucket(c.id) % 2 === 0) visible.push(c);
    else heldOut.push(c);
  }
  return { visible, heldOut };
}

function toFlow(cases: LabeledDispatchCase[]): EvalFlowFile {
  const rosterMap = new Map<string, LabeledDispatchCase['roster'][number]>();
  for (const c of cases) {
    for (const agent of c.roster) {
      if (!rosterMap.has(agent.key)) rosterMap.set(agent.key, agent);
    }
  }
  return {
    flow: 'chief-dispatch-real',
    roster: [...rosterMap.values()],
    cases: cases.map((c) => ({
      id: c.id,
      tags: c.tags,
      prompt: c.prompt,
      expect: c.expect,
    })),
  };
}

export function writeVisibleFlow(cases: LabeledDispatchCase[], dir: string): EvalFlowFile {
  mkdirSync(dir, { recursive: true });
  const flow = toFlow(cases);
  writeFileSync(join(dir, 'cases.json'), `${JSON.stringify(flow, null, 2)}\n`);
  return flow;
}

export function sealHeldOutCases(cases: LabeledDispatchCase[], box: SecretBox, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const payload = JSON.stringify(toFlow(cases));
  writeFileSync(path, box.seal(payload), { mode: 0o600 });
}

export function openHeldOutCases(path: string, box: SecretBox): LabeledDispatchCase[] {
  const envelope = readFileSync(path, 'utf8');
  const flow = JSON.parse(box.open(envelope)) as EvalFlowFile;
  return flow.cases.map((c) => ({
    id: c.id,
    tags: c.tags,
    prompt: c.prompt,
    expect: c.expect,
    roster: flow.roster,
  }));
}

export function formatHeldOutRunStdout(args: {
  half: string;
  caseCount: number;
  decisionOk: number;
  decisionOkInterval: [number, number];
  scored: number;
}): string {
  const [lo, hi] = args.decisionOkInterval;
  return [
    `half=${args.half}`,
    `cases=${args.caseCount}`,
    `scored=${args.scored}`,
    `decision_ok=${args.decisionOk.toFixed(4)}`,
    `decision_ok_95ci=[${lo.toFixed(4)}, ${hi.toFixed(4)}]`,
  ].join('\n');
}
