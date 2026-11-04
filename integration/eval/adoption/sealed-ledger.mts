import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AdoptionVerdict } from './judge.mts';

export interface SealedRead {
  runId: string;
  candidateId: string;
  readAt: string;
}

interface SealedLedger {
  version: 1;
  reads: SealedRead[];
}

export class SealedSetAlreadyRead extends Error {
  constructor(runId: string, previous: SealedRead) {
    super(
      `sealed set already read in run ${runId} by candidate ${previous.candidateId} at ${previous.readAt}`,
    );
    this.name = 'SealedSetAlreadyRead';
  }
}

function loadLedger(path: string): SealedLedger {
  if (!existsSync(path)) return { version: 1, reads: [] };
  return JSON.parse(readFileSync(path, 'utf8')) as SealedLedger;
}

export function sealedReads(ledgerPath: string, runId?: string): SealedRead[] {
  const { reads } = loadLedger(ledgerPath);
  return runId === undefined ? reads : reads.filter((r) => r.runId === runId);
}

export function readSealedOnce<T>(args: {
  ledgerPath: string;
  runId: string;
  candidateId: string;
  verdict: AdoptionVerdict;
  load: () => T;
  now?: () => Date;
}): T {
  if (args.verdict.decision !== 'accepted') {
    throw new Error(
      `sealed set is only readable for accepted candidates; ${args.candidateId} was ${args.verdict.decision}`,
    );
  }
  const ledger = loadLedger(args.ledgerPath);
  const previous = ledger.reads.find((r) => r.runId === args.runId);
  if (previous) throw new SealedSetAlreadyRead(args.runId, previous);
  ledger.reads.push({
    runId: args.runId,
    candidateId: args.candidateId,
    readAt: (args.now ?? (() => new Date()))().toISOString(),
  });
  mkdirSync(dirname(args.ledgerPath), { recursive: true });
  const staging = `${args.ledgerPath}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(staging, args.ledgerPath);
  return args.load();
}
