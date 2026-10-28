# Chief overlap surface acceptance

This phase repairs a capability gap in the original #1848 source. The chief has no shell, and its existing issue/PR list tools omit bodies and changed files. The worker command alone cannot implement its overlap rule.

The new github_overlaps tool authorizes the current team's GitHub-backed project through the existing connection path, performs complete paginated title/body searches and independent open-PR file scans, and returns full candidate text with head branches and renamed-file matches. Its data is explicitly untrusted. The same typed lookup now serves the worker CLI. Existing issue/PR list behavior is unchanged.

The producer runs a single eight-second abort budget within the existing ten-second relay timeout. Search incompleteness, malformed results, later-page failures, API errors, the PR-file API limit and page limits reject the operation. Reports over 64 KiB and per-query page data over 8 MiB are rejected explicitly. Unused API metadata is projected away; candidate titles and bodies are retained in full. The first live CLI result occupied 69,648 compact bytes with raw metadata. The projected live result occupies 29,189 compact bytes and still lists #2073 and #2047 as file overlaps.

Evidence:
- chief-overlap-red.log: the new positive lookup and later-page control fail before implementation because the chief tool is absent.
- chief-claim-red.log: both user and wake claims fail before prompt integration.
- chief-vocabulary-red.log and chief-vocabulary-green.log: the vocabulary contract is updated from 52 to 53 tools and the addition registry explicitly names github_overlaps. The historical 49-key extraction is unchanged. This is an intentional feature inventory change, not a relaxed scoring threshold.
- chief-overlap-size-red.log: valid oversized search results return success before the report budget is added.
- chief-overlap-projection-red.log: unused API metadata causes a false report-budget rejection before field projection.
- chief-overlap-final-green.log: 69 related server/shared tests pass, followed by lint, workspace typecheck and spec collection.
- chief-cli-final-green.log: the shared CLI and silent-revert controls pass.
- chief-overlap-source-files.json identifies the exact tested source, including files not yet committed when checked.
- live-cli-overlap-summary.json records a separate real GitHub lookup, result counts, full-body hashes and head branches. It is CLI evidence, not a real-model chief evaluation.

The in-process claim checks exercise the real server enrollment and task-claim APIs with synthetic identities and fixture GitHub responses. They confirm that user and wake turns receive the callable tool and chief-specific instructions without changing the turn instruction or trigger. They do not run a language model or establish live-provider duplicate detection.

The same-ask script control is now named for its actual scope: it routes a supplied existing-item identifier to an extension. It does not evaluate semantic matching. The real-model rephrased duplicate request, actual extension behavior, before-build plan evidence, workflow integration, repository instructions and final review remain required before a replacement PR is ready. No existing harness baseline, scoring rule or provider list is changed in this phase.
