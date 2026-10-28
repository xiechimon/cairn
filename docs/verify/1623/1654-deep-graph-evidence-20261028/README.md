# Bounded dependency traversal repair

Base checkpoint: `5141cff92dfbff2e4484642b12e6a0833f8b33c4`, with main base `6237fcb562bd159e82105ce8b9da680106e020bc`. The tests in this checkpoint were written before the traversal repair.

A legal-shaped 12000-node dependency chain fits below the 1 MiB request boundary, but the recursive checker overflowed before returning the configured six-child cap verdict. A cycle of the same depth also overflowed. The independent human persistence validator used another recursive traversal and threw RangeError instead of the established 400 cycle error. Auto and shadow failed before saving the required confirm proposal.

`red.log` records five failing negative controls: checker chain and cycle, plus the actual chief-tool cycle under human, shadow and auto. `focused-green.log` records all 64 tests passing after the repair. Both validators now share an explicit-stack depth-first traversal. Input sizes, child limits and dependency edges are unchanged. Cycle reasons remain failures, while a large acyclic chain returns the cap reason without falsely reporting a cycle.

Production-path tests require human to retain its existing 400 cycle error without writes. Auto and shadow must preserve the complete rejected cycle proposal and both cycle and cap reasons in the parent confirm build and plan, with no children or execution steps. The returned proposal remains nonexecutable under the existing rejection guards.

The single-use delivery gate also rejected a local test closure used only by its returned object property. That closure is now inline; the existing gate reports zero violations without an allowlist.

Final checks run sequentially under the shared single-slot wrapper: lint, typecheck, spec parsing, the same 27 relevant server/shared files with `--maxWorkers=1`, and the three existing isolated live-server split E2E cases on checked-free port 8498. These server tests and test-driven machine operations do not establish real-provider or real-daemon execution. No full prepush or push is performed by this lane; fresh independent review and the normal push hook remain separate steps.

Final result: all 350 tests in 27 files pass, all three E2E cases pass, and lint, typecheck, spec parsing and single-use checks pass. The wrapper acquired slot 1/1 and completed with exit code 0.
