import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import {
  CAIRN_ATTR,
  chatAttributes,
  executeToolAttributes,
  GENAI_ATTR,
  GENAI_OPERATION,
  invokeAgentAttributes,
} from '../src/genai-conventions.js';

test('names the operations and the convention keys the issue relies on', () => {
  expect(GENAI_OPERATION).toEqual({
    invokeAgent: 'invoke_agent',
    chat: 'chat',
    executeTool: 'execute_tool',
  });
  expect(GENAI_ATTR.operationName).toBe('gen_ai.operation.name');
  expect(GENAI_ATTR.providerName).toBe('gen_ai.provider.name');
  expect(GENAI_ATTR.requestModel).toBe('gen_ai.request.model');
  expect(GENAI_ATTR.responseFinishReasons).toBe('gen_ai.response.finish_reasons');
  expect(GENAI_ATTR.usageInputTokens).toBe('gen_ai.usage.input_tokens');
  expect(GENAI_ATTR.usageOutputTokens).toBe('gen_ai.usage.output_tokens');
  expect(CAIRN_ATTR.buildId).toBe('cairn.build_id');
  expect(CAIRN_ATTR.baseSha).toBe('cairn.base_sha');
  expect(CAIRN_ATTR.harnessHash).toBe('cairn.harness_hash');
  expect(CAIRN_ATTR.persona).toBe('cairn.persona');
});

test('every key in the maps is namespaced and unique', () => {
  const genai = Object.values(GENAI_ATTR);
  const cairn = Object.values(CAIRN_ATTR);
  expect(genai.every((key) => key.startsWith('gen_ai.'))).toBe(true);
  expect(cairn.every((key) => key.startsWith('cairn.'))).toBe(true);
  expect(new Set([...genai, ...cairn]).size).toBe(genai.length + cairn.length);
});

test('builders emit only keys from the maps and drop absent values', () => {
  const known = new Set<string>([...Object.values(GENAI_ATTR), ...Object.values(CAIRN_ATTR)]);
  const attributes = [
    invokeAgentAttributes({
      buildId: 'b',
      baseSha: 's',
      harnessHash: 'h',
      persona: null,
      agentId: 'a',
      provider: 'p',
      model: 'm',
      ciFixRounds: 0,
      sourceRef: null,
      outcome: null,
      attribution: null,
    }),
    chatAttributes(
      { model: 'm', finishReason: 'stop', usage: { input: 1 } },
      { provider: 'p', model: 'x' },
    ),
    executeToolAttributes({ name: 't' }),
  ];
  for (const set of attributes) {
    for (const key of Object.keys(set)) expect(known.has(key), key).toBe(true);
    expect(Object.values(set)).not.toContain(undefined);
  }
  expect(attributes[0]?.[CAIRN_ATTR.persona]).toBeUndefined();
  expect(attributes[1]?.[GENAI_ATTR.requestModel]).toBe('m');
  expect(attributes[1]?.[GENAI_ATTR.providerName]).toBe('p');
});

test('no other source file spells a gen_ai.* key', () => {
  const src = resolve(import.meta.dirname, '../src');
  const offenders = readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && file !== 'genai-conventions.ts')
    .filter((file) => /['"`]gen_ai\./.test(readFileSync(join(src, file), 'utf8')));
  expect(offenders).toEqual([]);
});
