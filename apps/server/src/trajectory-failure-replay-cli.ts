import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FAILURE_REPLAY_BANK_RELATIVE, redactSecrets } from '@cairn/shared';
import { otlpTraceIdOfBuild } from '@cairn/shared/otel';
import { ZodError } from 'zod';
import {
  confirmCandidatesByTraceIds,
  draftAssertionsFromFeedback,
  FailureReplayError,
  generateFailureReplayCandidates,
  materializeConfirmedBankCases,
  parseFailureReplayCandidates,
  parseFailureReplayPacks,
} from './trajectory-failure-replay.js';
import {
  enqueueFailureReplayCandidates,
  listCompletedFailureReplayItems,
  parseLangfuseAnnotationTarget,
} from './trajectory-failure-replay-queue.js';

const USAGE =
  'Use --generate --in <packs.jsonl> --out <candidates.jsonl> | --enqueue --in <candidates.jsonl> | --intake --in <candidates.jsonl> --bank <dir> [--out <candidates.jsonl>]';

try {
  const { values } = parseArgs({
    options: {
      generate: { type: 'boolean', default: false },
      enqueue: { type: 'boolean', default: false },
      intake: { type: 'boolean', default: false },
      in: { type: 'string' },
      out: { type: 'string' },
      bank: { type: 'string' },
    },
  });
  const modes = [values.generate, values.enqueue, values.intake].filter(Boolean);
  if (modes.length !== 1 || !values.in) throw new FailureReplayError(USAGE);

  if (values.generate) {
    if (!values.out) throw new FailureReplayError(USAGE);
    const packs = parseFailureReplayPacks(readFileSync(values.in, 'utf8'));
    const candidates = generateFailureReplayCandidates(packs, {
      draftAssertions: (feedback) => draftAssertionsFromFeedback(feedback),
      now: Date.now,
    });
    writeFileSync(
      values.out,
      candidates.length ? `${candidates.map((row) => JSON.stringify(row)).join('\n')}\n` : '',
      { flag: 'wx', mode: 0o600 },
    );
    const byEvent = Object.fromEntries(
      (['plan-rejection', 'review-blocking', 'post-merge-revert'] as const).map((event) => [
        event,
        candidates.filter((row) => row.event === event).length,
      ]),
    );
    console.log(
      `candidates=${candidates.length} plan_rejection=${byEvent['plan-rejection']} review_blocking=${byEvent['review-blocking']} post_merge_revert=${byEvent['post-merge-revert']} out=${redactSecrets(values.out).value}`,
    );
  } else if (values.enqueue) {
    const candidates = parseFailureReplayCandidates(readFileSync(values.in, 'utf8'));
    const target = parseLangfuseAnnotationTarget(process.env);
    const result = await enqueueFailureReplayCandidates(candidates, target);
    console.log(
      `enqueued=${result.enqueued} skipped=${result.skipped} queue=${target.queueId} host=${target.host}`,
    );
  } else {
    if (!values.bank) throw new FailureReplayError(USAGE);
    const candidates = parseFailureReplayCandidates(readFileSync(values.in, 'utf8'));
    const target = parseLangfuseAnnotationTarget(process.env);
    const completed = await listCompletedFailureReplayItems(target);
    const completedIds = new Set(completed.map((item) => item.objectId));
    const updated = confirmCandidatesByTraceIds(candidates, completedIds, otlpTraceIdOfBuild);
    const bankDir = resolve(values.bank);
    const written = materializeConfirmedBankCases(updated, bankDir, { now: Date.now });
    if (values.out) {
      writeFileSync(
        values.out,
        updated.length ? `${updated.map((row) => JSON.stringify(row)).join('\n')}\n` : '',
        { flag: 'wx', mode: 0o600 },
      );
    }
    console.log(
      `completed_queue_items=${completed.length} confirmed=${updated.filter((row) => row.status === 'confirmed').length} banked=${written.length} bank=${redactSecrets(bankDir).value} path_contract=${FAILURE_REPLAY_BANK_RELATIVE}`,
    );
  }
} catch (error) {
  const reason =
    error instanceof FailureReplayError
      ? error.message
      : error instanceof ZodError
        ? `Schema validation failed at ${error.issues.map((issue) => issue.path.join('.')).join(', ')}`
        : error instanceof SyntaxError
          ? 'Invalid JSONL input'
          : 'Invalid arguments or input/output I/O failed';
  console.error(`Failure-replay pipeline failed: ${reason}`);
  process.exitCode = 1;
}
