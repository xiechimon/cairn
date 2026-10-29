#!/usr/bin/env -S pnpm exec tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { redactSecrets } from '@cairn/shared';
import { type Labeler, labelDispatchCases } from './label.mts';
import type { ExportedDispatchCase } from './types.mts';

async function openAiLabeler(args: {
  vendor: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}): Promise<Labeler> {
  return {
    vendor: args.vendor,
    async label(input) {
      const body = {
        model: args.model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You assign a user request to exactly one agent key from the options list, or unclear. Reply with only the key or unclear.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              prompt: input.prompt,
              options: [...input.options, { key: 'unclear' }],
            }),
          },
        ],
      };
      const res = await fetch(`${args.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${args.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`labeler ${args.vendor} HTTP ${res.status}`);
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = json.choices?.[0]?.message?.content?.trim() ?? 'unclear';
      const token = text.split(/\s+/)[0] ?? 'unclear';
      return token;
    },
  };
}

const { values } = parseArgs({
  options: {
    in: { type: 'string' },
    out: { type: 'string' },
    'vendor-a': { type: 'string' },
    'vendor-b': { type: 'string' },
    'model-a': { type: 'string' },
    'model-b': { type: 'string' },
  },
});
if (!values.in || !values.out || !values['vendor-a'] || !values['vendor-b']) {
  console.error(
    'usage: label-cli.mts --in <redacted.json> --out <labeled.json> --vendor-a glm --vendor-b deepseek [--model-a ID] [--model-b ID]',
  );
  process.exit(2);
}
const baseA = process.env.CAIRN_LABELER_A_BASE_URL ?? process.env.CAIRN_LABELER_BASE_URL;
const keyA = process.env.CAIRN_LABELER_A_API_KEY ?? process.env.CAIRN_LABELER_API_KEY;
const baseB = process.env.CAIRN_LABELER_B_BASE_URL ?? process.env.CAIRN_LABELER_BASE_URL;
const keyB = process.env.CAIRN_LABELER_B_API_KEY ?? process.env.CAIRN_LABELER_API_KEY;
if (!baseA || !keyA || !baseB || !keyB) {
  console.error(
    'Set CAIRN_LABELER_A_BASE_URL/API_KEY and CAIRN_LABELER_B_BASE_URL/API_KEY (or shared CAIRN_LABELER_*)',
  );
  process.exit(2);
}
const raw = JSON.parse(readFileSync(resolve(values.in), 'utf8')) as {
  cases: ExportedDispatchCase[];
};
const labelers: [Labeler, Labeler] = [
  await openAiLabeler({
    vendor: values['vendor-a'],
    model: values['model-a'] ?? 'glm-5.3',
    baseUrl: baseA,
    apiKey: keyA,
  }),
  await openAiLabeler({
    vendor: values['vendor-b'],
    model: values['model-b'] ?? 'deepseek-v4-pro',
    baseUrl: baseB,
    apiKey: keyB,
  }),
];
const labeled = await labelDispatchCases(raw.cases, labelers);
writeFileSync(
  resolve(values.out),
  `${JSON.stringify({ labeledAt: new Date().toISOString(), cases: labeled }, null, 2)}\n`,
  { mode: 0o600 },
);
console.log(
  `labeled=${labeled.length} agreement_kept=${labeled.length}/${raw.cases.length} out=${redactSecrets(resolve(values.out)).value}`,
);
