# Orb secret isolation evidence (#2277)

Live Linux evidence is pending. The coordinator runs this command as `ian` from
the normally built matching checkout on omarchy, without sudo:

```sh
scripts/ops/orb/canary.sh --json --out docs/verify/2277/canary.json
```

The JSON is created exclusively and is added later by the coordinator. A local
fixture result must never be substituted for it. See the
[canary runbook](../../../scripts/ops/orb/README.md#secret-isolation-canary-2277)
for prerequisites, proof boundaries, sentinel safety and failure modes.

Local tests exercise the detector with fake secrets and a real scratch host
runner. They do not establish Linux nspawn or GitHub proxy acceptance.
