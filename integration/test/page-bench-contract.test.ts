import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

const benchRoot = join(import.meta.dirname, '../eval/harness-page-bench');
const questionsPath = join(benchRoot, 'questions.json');
const schemaPath = join(benchRoot, 'run-record.schema.json');

const PLACEHOLDER_CHECKS = [/looks good/i, /^ok$/i, /^pass$/i, /^fine$/i, /^works$/i];

const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const requirementSchema = z.object({
  id: z.string().min(1),
  check: z.string().min(1),
  how: z.string().min(1),
});

const questionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  requirements: z.array(requirementSchema).min(1),
  interactions: z.array(z.string().min(1)),
  viewports: z.object({
    desktop: viewportSchema,
    mobile: viewportSchema,
  }),
  network: z.object({
    allowExternal: z.boolean(),
  }),
});

const questionBankSchema = z.object({
  version: z.string().min(1),
  questions: z.array(questionSchema).min(8).max(10),
});

const screenshotSchema = z.object({
  viewport: z.enum(['desktop', 'mobile']),
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const runRecordSchema = z
  .object({
    questionBankVersion: z.string().min(1),
    questionId: z.string().min(1),
    requirements: z.record(z.string(), z.boolean()),
    buildOk: z.boolean(),
    consoleErrors: z.array(z.string()),
    screenshots: z.array(screenshotSchema).min(1),
    model: z.string().min(1),
    harnessVersion: z.string().min(1),
    budgets: z.object({
      wallMs: z.number().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    }),
    elapsedMs: z.number().nonnegative(),
    tokenUsage: z.object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
      cacheRead: z.number().int().nonnegative(),
      cacheWrite: z.number().int().nonnegative(),
    }),
    retries: z.number().int().nonnegative(),
  })
  .strict();

function loadQuestionBank() {
  expect(existsSync(questionsPath), `missing ${questionsPath}`).toBe(true);
  return questionBankSchema.parse(JSON.parse(readFileSync(questionsPath, 'utf8')));
}

function loadSchemaDocument() {
  expect(existsSync(schemaPath), `missing ${schemaPath}`).toBe(true);
  return JSON.parse(readFileSync(schemaPath, 'utf8')) as {
    version?: string;
    required?: string[];
    properties?: Record<string, unknown>;
    additionalProperties?: boolean;
  };
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sampleRecordFor(questionId: string, requirementIds: string[]) {
  const requirements: Record<string, boolean> = {};
  for (const id of requirementIds) requirements[id] = true;
  return {
    questionBankVersion: '1',
    questionId,
    requirements,
    buildOk: true,
    consoleErrors: [] as string[],
    screenshots: [
      {
        viewport: 'desktop' as const,
        path: 'artifacts/desktop.png',
        sha256: sha256Hex('desktop'),
      },
      {
        viewport: 'mobile' as const,
        path: 'artifacts/mobile.png',
        sha256: sha256Hex('mobile'),
      },
    ],
    model: 'glm-5.3-flash',
    harnessVersion: 'bare-pi@0',
    budgets: { wallMs: 120_000, inputTokens: 32_000, outputTokens: 8_000 },
    elapsedMs: 12_345,
    tokenUsage: { input: 1000, output: 200, cacheRead: 50, cacheWrite: 10 },
    retries: 0,
  };
}

function requirementCoverageComplete(
  authoritativeIds: string[],
  requirements: Record<string, boolean>,
): boolean {
  return authoritativeIds.every((id) => Object.hasOwn(requirements, id));
}

describe('page-bench contract', () => {
  test('questions.json has 8-10 questions with unique ids', () => {
    const bank = loadQuestionBank();
    expect(bank.questions.length).toBeGreaterThanOrEqual(8);
    expect(bank.questions.length).toBeLessThanOrEqual(10);
    const ids = bank.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every question has a nonempty requirement list, and requirement ids are unique', () => {
    const bank = loadQuestionBank();
    for (const question of bank.questions) {
      expect(question.requirements.length).toBeGreaterThan(0);
      const ids = question.requirements.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('every requirement has an observable check description', () => {
    const bank = loadQuestionBank();
    for (const question of bank.questions) {
      for (const requirement of question.requirements) {
        expect(requirement.check.trim().length).toBeGreaterThan(0);
        expect(requirement.how.trim().length).toBeGreaterThan(0);
        for (const pattern of PLACEHOLDER_CHECKS) {
          expect(requirement.check).not.toMatch(pattern);
        }
      }
    }
  });

  test('every question declares desktop and mobile viewports and a network policy', () => {
    const bank = loadQuestionBank();
    for (const question of bank.questions) {
      expect(question.viewports.desktop.width).toBeGreaterThan(0);
      expect(question.viewports.mobile.width).toBeGreaterThan(0);
      expect(question.viewports.mobile.width).toBeLessThan(question.viewports.desktop.width);
      expect(typeof question.network.allowExternal).toBe('boolean');
    }
  });

  test('a complete sample run record validates', () => {
    const bank = loadQuestionBank();
    const schema = loadSchemaDocument();
    expect(schema.version).toMatch(/^\d+/);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'questionBankVersion',
        'questionId',
        'requirements',
        'buildOk',
        'consoleErrors',
        'screenshots',
        'model',
        'harnessVersion',
        'budgets',
        'elapsedMs',
        'tokenUsage',
        'retries',
      ]),
    );
    const screenshots = schema.properties?.screenshots as {
      items?: { properties?: { viewport?: { enum?: string[] } }; required?: string[] };
    };
    expect(screenshots?.items?.required).toEqual(
      expect.arrayContaining(['viewport', 'path', 'sha256']),
    );
    expect(screenshots?.items?.properties?.viewport?.enum).toEqual(['desktop', 'mobile']);

    const question = bank.questions[0]!;
    const record = sampleRecordFor(
      question.id,
      question.requirements.map((r) => r.id),
    );
    expect(runRecordSchema.safeParse(record).success).toBe(true);
    for (const id of question.requirements.map((r) => r.id)) {
      expect(record.requirements).toHaveProperty(id);
    }
  });

  test('screenshotPaths as plain strings (the #1872 shape) fails', () => {
    const bank = loadQuestionBank();
    const question = bank.questions[0]!;
    const complete = sampleRecordFor(
      question.id,
      question.requirements.map((r) => r.id),
    );
    const { screenshots: _screenshots, ...withoutScreenshots } = complete;
    const legacy = {
      ...withoutScreenshots,
      screenshotPaths: ['desktop.png', 'mobile.png'],
    };
    expect(runRecordSchema.safeParse(legacy).success).toBe(false);
    expect(runRecordSchema.safeParse(withoutScreenshots).success).toBe(false);
    expect(runRecordSchema.safeParse({ ...complete, screenshotPaths: ['x.png'] }).success).toBe(
      false,
    );
  });

  test('a record missing a requirement verdict fails', () => {
    const bank = loadQuestionBank();
    const question = bank.questions[0]!;
    const ids = question.requirements.map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    const complete = sampleRecordFor(question.id, ids);
    expect(requirementCoverageComplete(ids, complete.requirements)).toBe(true);
    const incomplete = sampleRecordFor(question.id, ids.slice(1));
    expect(runRecordSchema.safeParse(incomplete).success).toBe(true);
    expect(requirementCoverageComplete(ids, incomplete.requirements)).toBe(false);
  });
});
