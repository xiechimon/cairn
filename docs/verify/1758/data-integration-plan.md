# Remaining delivery-metrics integration

## Verified prerequisites

The source review used main `3cca15fbe0e427154b134db0b433fc5e965119b2` and original PR #1787 head `a5c28990723e2044fb11c342d413750f1070b130`.

The installed weekly workflow runs on `ubuntu-latest`. It supplies neither a ledger nor trajectory packs to the metrics command. Repository Actions inventory reports zero self-hosted runners. Repository secret-name inventory contains only the existing Vercel deployment configuration, with no server-export or publication credential configured. Secret values were not read.

`apps/server/src/trajectory-outcome-backfill.ts` stores the outcome facts. `trajectory-export.ts` exports redacted packs containing `buildId`, usage, and outcomes, but no explicit repository or PR identifier. The database provides the join through build PR fields, todo project, and project repository. The exporter filters build creation time, so a weekly merge cohort cannot be implemented by passing the same time range without checking the joined PR cohort.

## Required data contract

A read-only server projection needs repository, PR number, build ID, export timestamp, backfill timestamp, nullable outcome signals, usage counts, and pricing coverage. It must carry no transcripts or credentials. It must preserve missing data, distinguish partial pricing from a complete zero cost, and deduplicate repeat exports by build ID. The report joins on repository and PR number and aggregates distinct associated builds once.

## Required publication behavior

The actual scheduled run must generate one JSON and its matching report, preserve JSON in `docs/metrics/` through the normal protected repository flow, and append the matching comment to #1717. An artifact alone is insufficient. Reruns must avoid duplicate comments and conflicting report versions. No branch protection bypass or new secret transfer is authorized by this document.

## Execution placement decision

One option is an isolated task on the existing server host, which can read server-local facts and use the existing publication identity without copying that identity into GitHub Actions. This changes the execution placement from the original GitHub-only workflow and requires owner agreement before host scheduling changes.

The other option retains GitHub-hosted execution and adds an explicitly approved authenticated export and publication channel. No such channel or credential is currently configured. It must be designed and authorized before connecting production data.

Neither option may change other agents, their worktrees, or their running tasks. The existing gardener sweep and the separately owned #2023 changes must be preserved. This document is a concrete remaining-work plan, not operational acceptance of issue #1758.
