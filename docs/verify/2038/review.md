# Delivery review

This is the author-side standalone code review of the complete branch diff against main `13e751c1b72b7012e6d4a940bc1cbe6a279b9d3c`. It is not an independent model verdict.

What it does:
- Delivers the bold-labeled checks from #2038 and fixes the heading extraction defect found while reviewing that PR. A level-three through level-six Verification heading owns its command and expected-result prose.

Good:
- The original nine-check #2006 fixture is retained. Heading regressions were written before applying the original source patch or the repair.
- Section extraction now retains applicable nested Verification headings for item splitting. Existing list headings remain grouping, and headings inside fences remain literal command content.
- The existing command/path anchors, vague-word rejection, feature-plan prior-art checks, public return type and dependency boundary remain intact.

Bad:
- The original PR advertises heading labels, but section extraction discards them before the label splitter can see them. Ten regression cases fail against its exact source. The corrected source passes all 49 contract tests.
- The broad affected run is tracked separately. It must not be reported as green solely because the focused contract tests pass.

Ugly:
- No new credential, authentication, dispatch, persistence or dependency behavior is introduced. Plan verification lists feed server build acceptance and retry lessons, so compatibility of existing list and plain-prose forms matters.

Tests:
- Main with the new tests: 12 failed, 37 passed.
- Original PR source `77aa4c8618a51ca52f1a209c7fa9419bad3bceb1` with the same tests: 10 failed, 39 passed.
- Corrected source: 49 passed. The regression set covers levels three to six, inline commands, fenced commands, prose-only labels, fenced heading text and known next-section boundaries.
- Lint, workspace typecheck and all spec collection pass; the captured output is in `required-green.log`.
- The shared parser is exercised directly. These results establish parsing and checklist construction, not a deployed planner or real-provider execution.

The simplification pass retains one labeled splitting mode and the existing section scanner. The repair changes two conditions without adding another parser or dependency. Existing product documents do not specify a different heading ownership contract; this delivery does not change a persisted schema or UI behavior.
