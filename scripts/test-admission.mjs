import { acquireSlot, leaseEnv, slotResources, slotWorkerBudget } from './heavy-slots.mjs';

const admission = Symbol.for('cairn.testAdmission');
const LIGHT_TEST_FILE_LIMIT = 4;
const TEST_FILE_ARG = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const VITEST_BIN = /(?:^|\/)vitest(?:\/|\.mjs$)|node_modules\/vitest/;

export function isVitestRunner(argv = process.argv) {
  return typeof argv[1] === 'string' && VITEST_BIN.test(argv[1]);
}

export function selectedTestFiles(argv = process.argv) {
  return argv.slice(2).filter((token) => !token.startsWith('-') && TEST_FILE_ARG.test(token));
}

export function lightTestRun(argv = process.argv) {
  if (!isVitestRunner(argv)) return null;
  const files = selectedTestFiles(argv);
  if (files.length === 0 || files.length > LIGHT_TEST_FILE_LIMIT) return null;
  return `${files.length} test file${files.length === 1 ? '' : 's'}`;
}

export function admitTestRun({ light = null } = {}) {
  process[admission] ??= acquireSlot({ light }).then((lease) => {
    Object.assign(process.env, leaseEnv(lease));
    return lease;
  });
  return process[admission];
}

export async function testRunPort(base) {
  const lease = await admitTestRun();
  return lease === null ? Number(base) : slotResources(lease.slot, { E2E_PORT: String(base) }).port;
}

export async function testRunWorkers() {
  const lease = await admitTestRun({ light: lightTestRun() });
  return slotWorkerBudget(lease) ?? undefined;
}
