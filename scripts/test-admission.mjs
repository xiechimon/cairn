import { acquireSlot, leaseEnv } from './heavy-slots.mjs';

const admission = Symbol.for('cairn.testAdmission');

export function admitTestRun() {
  process[admission] ??= acquireSlot().then((lease) => {
    Object.assign(process.env, leaseEnv(lease));
    return lease;
  });
  return process[admission];
}
