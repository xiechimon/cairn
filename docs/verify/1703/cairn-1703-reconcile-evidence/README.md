# PR 1703 reconciliation evidence

The direct-run test fails with the prepush-vitest script from main: the fake test process runs while the only resource slot is held. The same test passes with this PR, and the nested run reuses its inherited lease.

- `red.log`: original-script negative control, one test failed.
- `green.log`: both direct and inherited-lease tests passed.
- `regression.log`: heavy-slot, prepush and language tests, 44 passed.
- `prepush.log`: all 26 checks passed after reconciliation with main.

The run used Node 24.14.0 on macOS. TMPDIR was set to `/private/tmp`, its canonical filesystem path. Main's existing lessons CLI test otherwise compares a `/var` symlink path with its resolved module path and emits no CLI output. No test was skipped or assertion changed for that environment issue.

The merge preserves main's port-occupancy tests. Its isolated test fixture now creates the TMPDIR required by the updated sandbox. No product UI or server state is changed.
