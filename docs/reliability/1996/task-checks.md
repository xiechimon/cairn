# Task checks for the 1996 sample task set

Every task in `sample-tasks.json` was checked at the pinned base (`unjs/ufo` tag `v1.6.4`, commit `f06c800d0c59f2a4a1b9ba65eb6cb61a84419be6`, published as npm `ufo@1.6.4`) so that no task asks for behavior that already exists and every bug task's failing input is real.

Reproduce any single check with:

```sh
mkdir -p /tmp/ufo-check && cd /tmp/ufo-check
npm pack ufo@1.6.4            # built from the v1.6.4 release tag
tar xzf ufo-1.6.4.tgz --strip-components=1
node --input-type=module -e "<command below>"
```

Each `node --input-type=module -e` command below imports the tarball's `./package/dist/index.mjs` as `ufo`.

## ufo-01 (feature: `withoutQuery` does not exist)

```js
import * as ufo from './package/dist/index.mjs';
console.log(typeof ufo.withoutQuery, ufo.filterQuery('/list?page=2&tab=all#x', (k) => k !== 'tab'));
```

Output:

```
undefined /list?page=2#x
```

No removal helper is exported; the caller has to build a `filterQuery` predicate instead.

## ufo-02 (feature: `stringifyQuery` has no sort option)

```js
import * as ufo from './package/dist/index.mjs';
console.log(ufo.stringifyQuery({ b: 2, a: 1 }), ufo.stringifyQuery({ b: 2, a: 1 }, { sortKeys: true }));
```

Output:

```
b=2&a=1 b=2&a=1
```

The second call ignores the extra argument, so output order is still insertion order.

## ufo-03 (feature: `isEqual` cannot ignore the query string)

```js
import * as ufo from './package/dist/index.mjs';
console.log(ufo.isEqual('/list?page=1', '/list?page=2'), ufo.isEqual('/list?page=1', '/list?page=2', { ignoreSearch: true }));
```

Output:

```
false false
```

No option changes the comparison, so query strings always participate.

## ufo-04 (feature: `Date` serializes as a JSON-quoted string)

```js
import * as ufo from './package/dist/index.mjs';
const q = ufo.stringifyQuery({ since: new Date(Date.UTC(2026, 0, 1)) });
console.log(q, JSON.stringify(ufo.parseQuery(q)));
```

Output:

```
since=%222026-01-01T00%3A00%3A00.000Z%22 {"since":"\"2026-01-01T00:00:00.000Z\""}
```

The `%22` wraps are JSON quotes; the parsed value keeps the literal `"` characters.

## ufo-05 (feature: `normalizeURL` keeps the default port)

```js
import * as ufo from './package/dist/index.mjs';
console.log(ufo.normalizeURL('https://example.com:443/foo'), ufo.normalizeURL('http://example.com:8080/'));
```

Output:

```
https://example.com:443/foo http://example.com:8080/
```

The redundant `:443` survives normalization.

## ufo-06 (feature: `parseQuery` reads `tags[]` as a literal key)

```js
import * as ufo from './package/dist/index.mjs';
console.log(JSON.stringify(ufo.parseQuery('?tags[]=a&tags[]=b')));
```

Output:

```
{"tags[]":["a","b"]}
```

The brackets stay part of the key; there is no bracket-array mode.

## ufo-07 (bug: `parseHost` breaks on IPv6)

```js
import * as ufo from './package/dist/index.mjs';
console.log(JSON.stringify(ufo.parseHost('[::1]:3000')), JSON.stringify(ufo.parseHost('[::1]')), ufo.parseURL('http://[::1]:3000/a').host);
```

Output:

```
{"hostname":"["} {"hostname":"["} [::1]:3000
```

`parseHost` returns `{ hostname: '[' }` and loses the port, while `parseURL` keeps the bracketed host.

## ufo-08 (bug: `parseAuth` truncates colon passwords)

```js
import * as ufo from './package/dist/index.mjs';
console.log(JSON.stringify(ufo.parseAuth('user:pa:ss')), JSON.stringify(ufo.parseAuth('user:p%40ss')));
```

Output:

```
{"username":"user","password":"pa"} {"username":"user","password":"p@ss"}
```

Everything after the second colon is dropped; encoded characters decode normally.

## ufo-09 (bug: `isRelative('..')` is false)

```js
import * as ufo from './package/dist/index.mjs';
console.log(ufo.isRelative('..'), ufo.isRelative('../foo'));
```

Output:

```
false true
```

## ufo-10 (bug: `normalizeURL` keeps the host uppercase)

```js
import * as ufo from './package/dist/index.mjs';
console.log(ufo.normalizeURL('http://EXAMPLE.com/Foo'), new URL('HTTP://EXAMPLE.com/Foo').host);
```

Output:

```
http://EXAMPLE.com/Foo example.com
```

The native `URL` lowercases the host; `normalizeURL` does not.

## ufo-11 (bug: `withFragment` doubles a leading `#`)

```js
import * as ufo from './package/dist/index.mjs';
console.log(ufo.withFragment('/docs', '#intro'), ufo.parseURL('/docs##intro').hash, ufo.withFragment('/docs', '#'));
```

Output:

```
/docs##intro ##intro /docs
```

A bare `#` clears the fragment, but `#intro` produces a double hash that does not round trip.

## ufo-12 (test: `parseAuth` has no tests)

```sh
git clone --depth 1 --branch v1.6.4 https://github.com/unjs/ufo && cd ufo
rg -l parseAuth test/ src/
```

Output:

```
src/parse.ts
src/url.ts
```

`parseAuth` appears in the source but in no file under `test/`.

## ufo-13 (test: the prototype-pollution guard is untested)

```sh
rg -n '__proto__|constructor' test/
```

Output:

```
test/url.test.ts:54:  describe("constructor errors", () => {
```

The only hit is a `$URL` constructor-error suite; no test exercises `parseQuery`'s `__proto__` / `constructor` key guard.

## ufo-14 (docs: base-boundary rules are undocumented)

```js
import * as ufo from './package/dist/index.mjs';
console.log(ufo.withBase('/admin-dashboard', '/admin'), ufo.withBase('/admin/dashboard', '/admin'), ufo.withoutBase('/legacy//evil.com', '/legacy'));
```

Output:

```
/admin/admin-dashboard /admin/dashboard /evil.com
```

All three behaviors exist at the base but none of them appears in the JSDoc examples of `withBase` / `withoutBase`.

## ufo-15 (docs: no migration note for the deprecated `$URL`)

```js
import * as ufo from './package/dist/index.mjs';
console.log(typeof ufo.$URL, typeof ufo.createURL);
```

Output:

```
function function
```

Both deprecated helpers are still exported, and the README has no section explaining how to migrate off them.
