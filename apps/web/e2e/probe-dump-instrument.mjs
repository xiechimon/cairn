// Probe-dump instrumentation preload (#921).
//
// Loaded into every node process of a probe-dump run via
// NODE_OPTIONS="--import <this file>"; inert unless CAIRN_PROBE_DUMP_FILE
// is set. Two capture layers, both recording NDJSON lines into that file:
//
//   1. Assertion capture — the module-level `expect` export of
//      '@playwright/test' is replaced with a recording proxy that wraps
//      every matcher call and then delegates to the untouched original.
//      Each record carries both sides of an inline assertion: the expected
//      argument (the spec's old baseline) and the actual value (the new
//      measurement), with the spec file:line of the call site. Delegation
//      keeps matcher semantics exact — retries of web-first matchers,
//      expect.poll loops and failure messages all behave as in a plain run.
//
//   2. Probe capture — the root `test` is re-exported as a one-fixture
//      extension whose `page` override bootstraps prototype patches on the
//      playwright client classes (reached through the live fixture
//      instances' constructors — playwright-core 1.63 ships them inside a
//      bundle closure with no importable path). Patched methods:
//      evaluate / evaluateAll / boundingBox / waitForFunction on
//      Page / Frame / Locator / ElementHandle, plus Locator._expect (the
//      internal channel behind web-first matchers such as toHaveCSS, which
//      yields the `received` value). evaluate-family calls are recorded
//      only when the serialized callback mentions getComputedStyle or
//      getBoundingClientRect, so navigation and localStorage setup calls
//      stay out of the dump.
//
// Value notation contract (#411): records carry computed values verbatim;
// normalization to rgb/hex happens in the comparator (probe-dump.mjs), and
// oklch is flagged there as a contract violation, never converted.

import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const DUMP_FILE = process.env.CAIRN_PROBE_DUMP_FILE;
if (DUMP_FILE != null && DUMP_FILE !== '') {
  try {
    instrument(createRequire(import.meta.url));
  } catch (err) {
    // Fail open: a broken preload must surface as a missing-records run,
    // never as a playwright startup crash in unrelated node processes that
    // inherited NODE_OPTIONS (vite build/preview).
    process.stderr.write(`[probe-dump] instrumentation skipped: ${String(err)}\n`);
  }
}

function instrument(require) {
  const pt = require('@playwright/test');

  const state = { patchedPrototypes: false, evaluateDepth: 0 };

  // --- recording -------------------------------------------------------------

  function write(rec) {
    try {
      appendFileSync(DUMP_FILE, `${JSON.stringify(rec)}\n`);
    } catch {
      // A full or unreadable dump file must not fail the suite under test.
    }
  }

  function testTitle() {
    try {
      const info = pt.test.info();
      return { title: info.title, file: info.file };
    } catch {
      return null;
    }
  }

  const MAX_DEPTH = 4;
  const MAX_ITEMS = 64;
  const MAX_KEYS = 48;
  const MAX_STRING = 2000;

  function serialize(value, depth = 0, seen = new WeakSet()) {
    if (value === null) return null;
    const t = typeof value;
    if (t === 'undefined') return '__undefined__';
    if (t === 'boolean') return value;
    if (t === 'number') {
      if (Number.isNaN(value)) return '__NaN__';
      if (value === Number.POSITIVE_INFINITY) return '__Infinity__';
      if (value === Number.NEGATIVE_INFINITY) return '__-Infinity__';
      return value;
    }
    if (t === 'bigint') return `__bigint__${value}`;
    if (t === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
    if (t === 'function') {
      const src = String(value);
      return { __fn: src.length > 600 ? `${src.slice(0, 600)}…` : src };
    }
    if (value instanceof RegExp) return { __regex: String(value) };
    if (t === 'object') {
      if (seen.has(value)) return '__circular__';
      seen.add(value);
      if (depth >= MAX_DEPTH) return '__deep__';
      if (Array.isArray(value)) {
        const head = value.slice(0, MAX_ITEMS).map((v) => serialize(v, depth + 1, seen));
        if (value.length > MAX_ITEMS) head.push(`…+${value.length - MAX_ITEMS}`);
        return head;
      }
      // playwright client Locator: keep the selector as the identity.
      if (typeof value._selector === 'string') return { __locator: value._selector };
      const out = {};
      const keys = Object.keys(value);
      for (const k of keys.slice(0, MAX_KEYS)) out[k] = serialize(value[k], depth + 1, seen);
      if (keys.length > MAX_KEYS) out.__truncated = keys.length - MAX_KEYS;
      if (keys.length === 0) {
        const name = value.constructor?.name;
        if (name != null && name !== 'Object') return { __object: name };
      }
      return out;
    }
    return String(value);
  }

  const STACK_FRAME = /(?:^|\s|\/)([^\s()/]+\.m?[cj]?ts):(\d+):(\d+)\)?$/;

  /** First stack frame inside apps/web/e2e, preferring *.spec.ts frames. */
  function specCallSite() {
    const stack = new Error().stack ?? '';
    let anyE2e = null;
    for (const line of stack.split('\n').slice(1)) {
      if (line.includes('probe-dump-instrument')) continue;
      if (!line.includes('/e2e/')) continue;
      const m = STACK_FRAME.exec(line.trim());
      if (m == null) continue;
      const path = m[1] ?? '';
      const site = { f: path.slice(path.lastIndexOf('/e2e/') + 1), l: Number(m[2]) };
      if (site.f.endsWith('.spec.ts')) return site;
      anyE2e ??= site;
    }
    return anyE2e;
  }

  // --- layer 1: assertion capture ---------------------------------------------

  const CHAIN_PROPS = new Set(['not', 'resolves', 'rejects']);

  const VISUAL_MATCHERS = new Set([
    'toBe',
    'toEqual',
    'toBeCloseTo',
    'toContain',
    'toMatch',
    'toBeGreaterThan',
    'toBeGreaterThanOrEqual',
    'toBeLessThan',
    'toBeLessThanOrEqual',
    'toHaveCSS',
  ]);

  function wrapMatcherHost(host, actual, negated, chain) {
    return new Proxy(host, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, target);
        if (typeof prop !== 'string') return v;
        if (CHAIN_PROPS.has(prop)) {
          return wrapMatcherHost(v, actual, prop === 'not' ? !negated : negated, [...chain, prop]);
        }
        if (typeof v !== 'function') return v;
        if (!VISUAL_MATCHERS.has(prop)) {
          // Delegate behavioral matchers verbatim; no record, no stack walk.
          return v.bind(target);
        }
        return (...margs) => recordMatcher(target, prop, v, margs, actual, negated, chain);
      },
    });
  }

  function recordMatcher(thisArg, matcher, orig, margs, actual, negated, chain) {
    const site = specCallSite();
    const t = testTitle();
    const rec = {
      k: 'a',
      m: matcher,
      n: negated,
      ...(chain.length > 0 ? { c: chain } : {}),
      ...(site ?? {}),
      v: serialize(actual),
      e: margs.map((a) => serialize(a)),
      ...(t != null ? { tt: t.title } : {}),
    };
    let result;
    try {
      result = orig.apply(thisArg, margs);
    } catch (err) {
      write({ ...rec, r: 'fail' });
      throw err;
    }
    if (result instanceof Promise) {
      // Web-first matchers resolve/reject asynchronously; report the outcome
      // as a second record line so the dump survives a rejected await.
      write({ ...rec, r: 'pending' });
      result.then(
        () => write({ ...rec, r: 'pass' }),
        () => write({ ...rec, r: 'fail' }),
      );
      return result;
    }
    write({ ...rec, r: 'pass' });
    return result;
  }

  function wrapExpect(real) {
    return new Proxy(real, {
      apply(target, thisArg, args) {
        return wrapMatcherHost(Reflect.apply(target, thisArg, args), args[0], false, []);
      },
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, target);
        if (prop === 'poll') {
          return (actual, opts) => wrapMatcherHost(v.call(target, actual, opts), actual, false, []);
        }
        if (prop === 'soft' || prop === 'extend') {
          // Both yield fresh expect functions; keep them wrapped.
          if (typeof v === 'function' && prop === 'extend') {
            return (...a) => wrapExpect(v(...a));
          }
          return wrapExpect(v);
        }
        return v;
      },
    });
  }

  const wrappedExpect = wrapExpect(pt.expect);
  pt.expect = wrappedExpect;

  // --- layer 2: probe capture ---------------------------------------------------

  const PROBE_SOURCE = /getComputedStyle|getBoundingClientRect/;

  function isProbeCallback(fn) {
    return (typeof fn === 'function' || typeof fn === 'string') && PROBE_SOURCE.test(String(fn));
  }

  function patchEvaluate(proto, method, cls) {
    const orig = proto[method];
    if (typeof orig !== 'function' || orig.__probePatched === true) return;
    const patched = function (fn, arg) {
      const outermost = state.evaluateDepth === 0;
      const site = outermost && isProbeCallback(fn) ? specCallSite() : null;
      const t = outermost && site != null ? testTitle() : null;
      const run = async () => {
        state.evaluateDepth += 1;
        try {
          return await orig.call(this, fn, arg);
        } finally {
          state.evaluateDepth -= 1;
        }
      };
      const p = run();
      if (site != null) {
        const selector = typeof this._selector === 'string' ? this._selector : null;
        p.then(
          (value) =>
            write({
              k: 'p',
              p: 'style',
              cls,
              ...site,
              ...(selector != null ? { loc: selector } : {}),
              v: serialize(value),
              ...(t != null ? { tt: t.title } : {}),
            }),
          () => {},
        );
      }
      return p;
    };
    patched.__probePatched = true;
    proto[method] = patched;
  }

  function patchBoundingBox(proto, cls) {
    const orig = proto.boundingBox;
    if (typeof orig !== 'function' || orig.__probePatched === true) return;
    const patched = function (options) {
      const site = specCallSite();
      const t = testTitle();
      const p = Promise.resolve(orig.call(this, options));
      if (site != null) {
        const selector = typeof this._selector === 'string' ? this._selector : null;
        p.then(
          (value) =>
            write({
              k: 'p',
              p: 'box',
              cls,
              ...site,
              ...(selector != null ? { loc: selector } : {}),
              v: serialize(value),
              ...(t != null ? { tt: t.title } : {}),
            }),
          () => {},
        );
      }
      return p;
    };
    patched.__probePatched = true;
    proto.boundingBox = patched;
  }

  function patchWaitForFunction(proto) {
    const orig = proto.waitForFunction;
    if (typeof orig !== 'function' || orig.__probePatched === true) return;
    const patched = function (fn, arg, options) {
      if (isProbeCallback(fn)) {
        const site = specCallSite();
        const t = testTitle();
        if (site != null) {
          write({ k: 'p', p: 'wait', ...site, v: null, ...(t != null ? { tt: t.title } : {}) });
        }
      }
      return orig.call(this, fn, arg, options);
    };
    patched.__probePatched = true;
    proto.waitForFunction = patched;
  }

  // Only `to.have.css` (toHaveCSS) needs the _expect channel: it is the one
  // web-first matcher whose received value — the current computed CSS — is the
  // "new measured" side of a visual baseline and is not visible to the
  // assertion wrapper (which sees the Locator, not the resolved style). The
  // other web-first matchers (toBeVisible, toHaveCount, toHaveText, …) are
  // behavioral and already captured pass/fail by the assertion layer, so
  // recording their _expect traffic would only add noise.
  const VISUAL_EXPECT_SELECTOR = 'to.have.css';

  function patchLocatorExpect(proto) {
    const orig = proto._expect;
    if (typeof orig !== 'function' || orig.__probePatched === true) return;
    const patched = async function (selector, options) {
      const result = await orig.call(this, selector, options);
      if (selector === VISUAL_EXPECT_SELECTOR) {
        try {
          // `_expect` runs inside playwright's async retry loop, so Error.stack
          // is detached from the spec line; test.info() is stack-independent
          // and keys the received value back to its assertion. The line is best
          // effort — present when the matcher resolved synchronously.
          const site = specCallSite();
          const t = testTitle();
          // On a match playwright returns only { matches: true }; on drift it
          // returns received.value = the current computed CSS — the new
          // measured side. expectedText is [{ string|regexSource, … }].
          const received = result?.received;
          write({
            k: 'w',
            sel: selector,
            prop: options?.expressionArg ?? null,
            e: serialize(options?.expectedText ?? options?.expectedNumber ?? null),
            v: serialize(received?.value ?? received ?? null),
            r: result?.matches === true ? 'pass' : 'fail',
            ...(site ?? {}),
            ...(typeof this._selector === 'string' ? { loc: this._selector } : {}),
            ...(t != null ? { tt: t.title } : {}),
          });
        } catch {
          // Recording must never mask the matcher outcome.
        }
      }
      return result;
    };
    patched.__probePatched = true;
    proto._expect = patched;
  }

  async function bootstrapPrototypes(page) {
    if (state.patchedPrototypes) return;
    state.patchedPrototypes = true;
    const frame = page.mainFrame();
    const locator = page.locator('html');
    const PageProto = Object.getPrototypeOf(page);
    const FrameProto = Object.getPrototypeOf(frame);
    const LocatorProto = Object.getPrototypeOf(locator);
    patchEvaluate(PageProto, 'evaluate', 'Page');
    patchEvaluate(FrameProto, 'evaluate', 'Frame');
    patchEvaluate(LocatorProto, 'evaluate', 'Locator');
    patchEvaluate(LocatorProto, 'evaluateAll', 'Locator');
    patchWaitForFunction(FrameProto);
    patchWaitForFunction(LocatorProto);
    patchBoundingBox(LocatorProto, 'Locator');
    patchLocatorExpect(LocatorProto);
    const handle = await locator.elementHandle().catch(() => null);
    if (handle != null) {
      const HandleProto = Object.getPrototypeOf(handle);
      patchEvaluate(HandleProto, 'evaluate', 'ElementHandle');
      patchBoundingBox(HandleProto, 'ElementHandle');
    }
  }

  // The fixture override is the bootstrap vehicle only: it materializes once
  // per test that uses `page` and patches the shared prototypes on first
  // call. Tests that never touch `page` are unaffected — no forced browser.
  pt.test = pt.test.extend({
    page: async ({ page }, use) => {
      await bootstrapPrototypes(page);
      await use(page);
    },
  });
}
