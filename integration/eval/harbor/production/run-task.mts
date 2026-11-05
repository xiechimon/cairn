import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { claimedStepSchema, providerConfigSchema } from '@cairn/shared';
import { z } from 'zod';
import { executeProductionTask } from './runner.mjs';

const descriptorSchema = z
  .object({
    taskDir: z.string().min(1),
    stateDir: z.string().min(1),
    claimed: claimedStepSchema,
    provider: providerConfigSchema.omit({ apiKey: true }).strict(),
    skillsDir: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

const [descriptorPath, outputPath] = process.argv.slice(2);
if (descriptorPath === undefined || outputPath === undefined) {
  throw new Error('Usage: run-task <descriptor.json> <output-dir>');
}
const descriptor = descriptorSchema.parse(JSON.parse(readFileSync(descriptorPath, 'utf8')));
const result = await executeProductionTask({
  root: descriptor.stateDir,
  taskDir: descriptor.taskDir,
  claimed: descriptor.claimed,
  provider: { ...descriptor.provider, apiKey: 'relay-placeholder' },
  ...(descriptor.skillsDir !== undefined ? { skillsDir: descriptor.skillsDir } : {}),
  ...(descriptor.timeoutMs !== undefined ? { timeoutMs: descriptor.timeoutMs } : {}),
});
mkdirSync(outputPath, { recursive: true });
for (const [name, content] of Object.entries(result.artifacts)) {
  writeFileSync(resolve(outputPath, name), content);
}
writeFileSync(
  resolve(outputPath, 'executor-record.json'),
  `${JSON.stringify(result.executorRecord)}\n`,
);
writeFileSync(
  resolve(outputPath, 'execution.json'),
  `${JSON.stringify({ done: result.done, tools: result.tools })}\n`,
);
writeFileSync(resolve(outputPath, 'daemon.log'), `${result.logs.join('\n')}\n`);
if (result.done.status !== 'success') process.exitCode = 1;
