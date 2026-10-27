# PR 1906 runtime verification

The final verifier and oracle scripts from this branch ran on omarchy in isolated containers using the existing image `sha256:f9b3e7d79aac10c634f9579808636465c1c2ddd837f788d0b2ac41e989eb035a`.

- Docker network mode `none`: exit 0, one pytest case passed, reward 1, probe `offline`.
- Docker network mode `host`: exit 1 before pytest, reward 0, probe `online`.
- Both containers were removed after inspection. No running service or agent was changed.
- The source-level regression suite passed all four cases locally.

`runtime.log` records the actual container results and Docker-inspected network modes. The endpoint probe measures reachability of 8.8.8.8:53; Docker's `none` mode is the isolation control. The test directory was mounted read-only, so pytest emitted a cache-write warning while the oracle assertion passed.

This rechecks the final scoring script and its negative control. The previously recorded full Harbor run remains in the parent evidence README; no new full Harbor run is claimed.
