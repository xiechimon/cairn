import {
  DELIVERABLE_LIMITS,
  type MachineDoneBody,
  PLAN_FILE_NAME,
  SESSION_FILE_NAME,
  type TranscriptUpload,
} from '@cairn/shared';
import { type StepJournal, type StepJournalEntry, TranscriptBuffer } from './journal.js';
import type { DaemonLogger } from './log.js';
import { isTransientUploadError, type MachineApi, MachineApiError } from './machine-client.js';
import type { RunStepDeps } from './runner.js';
import { readSessionJsonlForUpload } from './session-jsonl.js';
import {
  type DeliverableDoneFields,
  DeliverableRejectedError,
  type DeliverableSnapshot,
  deliverableDoneFields,
} from './step-deliverables.js';

const UPLOAD_RETRY_ATTEMPTS = 3;
const UPLOAD_RETRY_DELAY_MS = 1_000;

function finalUploadFiles(
  messages: TranscriptUpload['messages'],
  planContent: string | null,
  sessionContent: string | null,
): { name: string; size?: number }[] {
  const files: { name: string; size?: number }[] = [
    { name: 'transcript.json', size: JSON.stringify(messages).length },
  ];
  if (planContent !== null) files.push({ name: PLAN_FILE_NAME, size: planContent.length });
  if (sessionContent !== null) files.push({ name: SESSION_FILE_NAME, size: sessionContent.length });
  return files;
}

export async function putFinalArtifacts(
  client: MachineApi,
  logger: DaemonLogger,
  stepId: string,
  messages: TranscriptUpload['messages'],
  planContent: string | null,
  sessionFile: string | undefined,
): Promise<void> {
  const sessionContent = readSessionJsonlForUpload(sessionFile, (msg) => logger.step(msg));
  const files = finalUploadFiles(messages, planContent, sessionContent);
  for (let attempt = 1; ; attempt++) {
    try {
      const { uploads } = await client.uploadUrls(stepId, files);
      for (const upload of uploads) {
        if (upload.name === PLAN_FILE_NAME) {
          if (planContent !== null) {
            await client.putUpload(upload.url, upload.headers, planContent, 'text/markdown');
          }
        } else if (upload.name === SESSION_FILE_NAME) {
          if (sessionContent !== null) {
            try {
              await client.putUpload(
                upload.url,
                upload.headers,
                sessionContent,
                'application/x-ndjson',
              );
            } catch (err) {
              logger.step(
                `session upload failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        } else if (upload.name === 'transcript.json') {
          await client.putUpload(upload.url, upload.headers, { stepId, messages });
        }
      }
      return;
    } catch (err) {
      if (attempt >= UPLOAD_RETRY_ATTEMPTS || !isTransientUploadError(err)) throw err;
      logger.step(
        `upload attempt ${attempt} failed (${
          err instanceof Error ? err.message : String(err)
        }) — re-requesting presigned urls`,
      );
      await new Promise((r) => setTimeout(r, UPLOAD_RETRY_DELAY_MS));
    }
  }
}

export async function completeWithDeliverables(
  client: MachineApi,
  logger: DaemonLogger,
  journal: StepJournal,
  stepId: string,
  doneBody: MachineDoneBody,
  snapshot: DeliverableSnapshot | null,
): Promise<void> {
  if (snapshot === null) return client.done(stepId, doneBody);
  let fields: DeliverableDoneFields | null;
  try {
    if (snapshot.copyDir !== journal.deliverablesDir(stepId)) {
      throw new DeliverableRejectedError('deliverable copies are outside the outbox');
    }
    fields = await deliverableDoneFields(client, logger, stepId, snapshot);
  } catch (err) {
    if (!rejectsDeliverables(err)) throw err;
    logger.step(
      `deliverables rejected (${err instanceof Error ? err.message : String(err)}); reporting without them`,
    );
    const rejectedBody: MachineDoneBody = {
      ...doneBody,
      generation: snapshot.generation,
      deliverables: [],
      deliverablesSkipped: [
        ...snapshot.skipped,
        ...snapshot.files.map((f) => ({ name: f.name, reason: 'upload-rejected' })),
      ].slice(0, DELIVERABLE_LIMITS.maxSkipped),
    };
    journal.update(stepId, { doneBody: rejectedBody });
    journal.dropDeliverables(stepId);
    return client.done(stepId, rejectedBody);
  }
  if (fields === null) {
    const names = [...snapshot.files, ...snapshot.skipped].map((f) => f.name).join(', ');
    logger.step(`server does not take deliverables; reporting without them (${names})`);
    journal.dropDeliverables(stepId);
    return client.done(stepId, doneBody);
  }
  await client.done(stepId, { ...doneBody, ...fields });
}

const RETRY_LATER_STATUSES = new Set([408, 409, 429]);

function rejectsDeliverables(err: unknown): boolean {
  if (err instanceof DeliverableRejectedError) return true;
  return (
    err instanceof MachineApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    !RETRY_LATER_STATUSES.has(err.status)
  );
}

type ReceiptOutcome = 'claimed' | 'finished' | 'superseded' | 'unsupported' | 'retry';

async function receiptOutcome(
  client: MachineApi,
  logger: DaemonLogger,
  stepId: string,
  generation: number,
): Promise<ReceiptOutcome> {
  if (client.deliverableReceipt === undefined) return 'unsupported';
  try {
    return await client.deliverableReceipt(stepId, generation);
  } catch (err) {
    if (err instanceof MachineApiError && err.status === 404) return 'unsupported';
    logger.step(`receipt check failed: ${err instanceof Error ? err.message : String(err)}`);
    return 'retry';
  }
}

export async function resumePendingUpload(
  deps: Pick<RunStepDeps, 'client' | 'journal' | 'logger' | 'paths' | 'sessionHandles'>,
  entry: StepJournalEntry,
  opts: { running?: number; failOnRejectedDone?: boolean } = {},
): Promise<void> {
  const { client, journal, logger } = deps;
  const stepId = entry.stepId;
  const doneBody = entry.doneBody;
  if (doneBody == null) return;
  const running = opts.running ?? 1;
  logger.recover(`step ${stepId} awaiting upload — replaying final report (no agent round)`);
  let snapshot = entry.deliverables ?? null;
  const generation = snapshot?.generation ?? doneBody.generation;
  const dropFinished = (state: ReceiptOutcome): boolean => {
    if (state !== 'finished' && state !== 'superseded') return false;
    logger.recover(`step ${stepId} is ${state} on the server — dropping its journal`);
    journal.remove(stepId);
    deps.sessionHandles?.delete(stepId);
    return true;
  };
  if (generation !== undefined) {
    const state = await receiptOutcome(client, logger, stepId, generation);
    if (state === 'retry' || dropFinished(state)) return;
    if (state === 'unsupported' && snapshot !== null) {
      snapshot = null;
      journal.dropDeliverables(stepId);
    }
  }
  const transcript = new TranscriptBuffer(deps.paths.outboxDir, stepId);
  const messages = transcript.messages();
  const planContent = entry.planContent ?? null;
  try {
    await putFinalArtifacts(
      client,
      logger,
      stepId,
      messages,
      planContent,
      entry.sessionFile ?? undefined,
    );
  } catch (err) {
    logger.step(`transcript upload failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  try {
    await completeWithDeliverables(client, logger, journal, stepId, doneBody, snapshot);
  } catch (err) {
    logger.step(`done report failed: ${err instanceof Error ? err.message : String(err)}`);
    if (generation !== undefined && err instanceof MachineApiError && err.status === 409) {
      dropFinished(await receiptOutcome(client, logger, stepId, generation));
      return;
    }
    if (
      !opts.failOnRejectedDone ||
      !(err instanceof MachineApiError) ||
      err.status < 400 ||
      err.status >= 500
    )
      return;
    const failedBody: MachineDoneBody = {
      status: 'failed',
      errorMessage: `Orb completion rejected with HTTP ${err.status}: ${err.body}`,
    };
    journal.update(stepId, { doneBody: failedBody });
    try {
      await client.done(stepId, failedBody);
    } catch (error) {
      logger.step(
        `done(failed) report unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
  }
  journal.remove(stepId);
  deps.sessionHandles?.delete(stepId);
  logger.raw(`finished (${running - 1} running)`);
}
