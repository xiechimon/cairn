# #1256 merge hard-block gate — test artifacts (local rerun 2026-10-13 16:30)

Command (from the apps/server workspace):

    pnpm vitest run test/chief-dispatch.test.ts test/mcp-face.test.ts

Output tail:

    Test Files  2 passed (2)
          Tests  19 passed (19)
       Start at  16:30:55
       Duration  2.13s

Coverage: chief relay face merge_builds hard block (the refusal copy names the
manual exit) / MCP face same gate / existing dispatch and read tool faces do
not regress. The integration stack m4b-watch-wake's CI timeout is under
separate diagnosis (suspected flake, independent of this gate's unit-test face).
