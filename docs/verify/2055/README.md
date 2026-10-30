# #2055 attachment grant signing and upload containment

Repair for the public attachment MAC key and path-escape finding from
pre-launch review #2000.

## Test first

Six failing cases plus the single-use replay update landed in
`apps/server/test/attachments.test.ts` before the product change. Against
main's signing and upload path they fail (7 red). See [red.log](red.log).

```sh
pnpm exec vitest run apps/server/test/attachments.test.ts
```

After the fix the same file is green with the related suites. See
[green.log](green.log).

```sh
pnpm exec vitest run apps/server/test/attachments.test.ts \
  apps/server/test/secret-box.test.ts \
  apps/server/test/attachment-gc.test.ts \
  apps/server/test/machine-attachment.test.ts
```

## Secure probe

Adapted from `docs/verify/2000/security-probes.ts` (attachment forgery only),
plus cross-installation and a valid-upload control:

```sh
pnpm --filter @xiechimon/cairn exec tsx ../../docs/verify/2055/security-probes.ts --expect-secure
```

See [security-secure.log](security-secure.log).

## Gates

- [lint.log](lint.log)
- [typecheck.log](typecheck.log)
- [spec-parse.log](spec-parse.log)
