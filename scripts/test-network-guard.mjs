import { Socket } from 'node:net';
import { networkInterfaces } from 'node:os';

const LOCAL_HOSTS = new Set([
  'localhost',
  '::1',
  '[::1]',
  ...Object.values(networkInterfaces()).flatMap((addresses) =>
    (addresses ?? []).flatMap(({ address }) => [address, `[${address}]`]),
  ),
]);

const unstubbedCalls = [];
const SOURCE_FRAME = /(?:\/apps\/(?:server|daemon|desktop|web)|\/packages\/[^/]+)\/src\//;
let installed = false;

function isLocal(host) {
  return LOCAL_HOSTS.has(host) || host.endsWith('.localhost') || host.startsWith('127.');
}

function callSite() {
  const frame = new Error().stack?.split('\n').find((line) => SOURCE_FRAME.test(line));
  return frame === undefined ? '' : ` (${frame.trim()})`;
}

export function recordUnstubbedNetworkCall(call, suite = 'test') {
  unstubbedCalls.push(`${call}${callSite()}`);
  return new Error(
    `unstubbed network call from a ${suite} test: ${call}; pass the test an explicit stub`,
  );
}

export function takeUnstubbedNetworkCalls() {
  return unstubbedCalls.splice(0);
}

function requestUrl(input) {
  const raw = input instanceof Request ? input.url : String(input);
  return URL.canParse(raw) ? new URL(raw) : null;
}

function socketHost(args) {
  const [first, second] = args;
  if (Array.isArray(first)) return socketHost(first);
  if (typeof first === 'object' && first !== null) {
    if (typeof first.path === 'string') return null;
    return typeof first.host === 'string' ? first.host : 'localhost';
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null;
  return typeof second === 'string' ? second : 'localhost';
}

function wrapLookup(origLookup, host, suite) {
  return function guardedLookup(hostname, lookupOpts, callback) {
    const cb = typeof lookupOpts === 'function' ? lookupOpts : callback;
    const wrappedCb = (err, address, family) => {
      if (err) {
        cb(err, address, family);
        return;
      }
      const addresses = Array.isArray(address) ? address.map((entry) => entry?.address) : [address];
      if (
        addresses.length > 0 &&
        addresses.every((addr) => typeof addr === 'string' && isLocal(addr))
      ) {
        cb(null, address, family);
        return;
      }
      cb(recordUnstubbedNetworkCall(`socket connect ${host}`, suite));
    };
    if (typeof lookupOpts === 'function') return origLookup.call(this, hostname, wrappedCb);
    return origLookup.call(this, hostname, lookupOpts, wrappedCb);
  };
}

function withGuardedLookup(args, host, suite) {
  const [first, ...rest] = args;
  if (Array.isArray(first)) {
    const [options, cb] = first;
    if (typeof options === 'object' && options !== null && typeof options.lookup === 'function') {
      const guarded = { ...options, lookup: wrapLookup(options.lookup, host, suite) };
      return typeof cb === 'function' ? [guarded, cb] : [guarded];
    }
    return null;
  }
  if (typeof first === 'object' && first !== null && typeof first.lookup === 'function') {
    return [{ ...first, lookup: wrapLookup(first.lookup, host, suite) }, ...rest];
  }
  return null;
}

export function installNetworkGuard(options = {}) {
  if (installed) return;
  installed = true;
  const suite = options.suite ?? 'test';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = requestUrl(input);
    if (url === null || !/^(https?|wss?):$/.test(url.protocol) || isLocal(url.hostname)) {
      return realFetch(input, init);
    }
    return Promise.reject(
      recordUnstubbedNetworkCall(`fetch ${init?.method ?? 'GET'} ${url.href}`, suite),
    );
  };
  const realConnect = Socket.prototype.connect;
  Socket.prototype.connect = function (...args) {
    const host = socketHost(args);
    if (host === null || isLocal(host)) return realConnect.apply(this, args);
    const wrappedArgs = withGuardedLookup(args, host, suite);
    if (wrappedArgs !== null) return realConnect.apply(this, wrappedArgs);
    const error = recordUnstubbedNetworkCall(`socket connect ${host}`, suite);
    process.nextTick(() => this.destroy(error));
    return this;
  };
}
