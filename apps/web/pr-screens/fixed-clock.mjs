import { FROZEN_AT } from './frozen-time.mjs';

const RealDate = globalThis.Date;

globalThis.Date = new Proxy(RealDate, {
  apply: () => new RealDate(FROZEN_AT).toString(),
  construct: (target, args, newTarget) =>
    Reflect.construct(target, args.length ? args : [FROZEN_AT], newTarget),
  get: (target, key, receiver) =>
    key === 'now' ? () => FROZEN_AT : Reflect.get(target, key, receiver),
});
