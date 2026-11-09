import { acquireSlot, leaseEnv, slotResources } from './heavy-slots.mjs';

const admission = Symbol.for('cairn.testAdmission');

export function admitTestRun() {
  process[admission] ??= acquireSlot().then((lease) => {
    Object.assign(process.env, leaseEnv(lease));
    return lease;
  });
  return process[admission];
}

export async function testRunPort(base) {
  const lease = await admitTestRun();
  return lease === null ? Number(base) : slotResources(lease.slot, { E2E_PORT: String(base) }).port;
}
