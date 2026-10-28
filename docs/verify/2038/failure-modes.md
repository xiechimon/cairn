# Verification parsing failure modes

1. Bold labels split from their fenced commands and expected-result prose.
2. Heading labels lose inline commands during section extraction.
3. Heading labels split from following fenced commands and expected results.
4. List grouping headings turn into extra checks or alter the returned list.
5. Hash-prefixed command text inside fences becomes a heading or a new section.
6. A named next plan section is absorbed into Verification.
7. A prose-only labeled check is accepted because another check has a command.
8. Existing plain prose, indented fences, CRLF input and prior-art validation change behavior.

The original #2038 tests and the heading regressions are added before changing the implementation. No execution anchor, vague-word rejection, prior-art requirement or existing assertion is weakened.
