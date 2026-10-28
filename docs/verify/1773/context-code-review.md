# Context-window code review

Reviewed source: `2ca1ade918b3311764874d730e717ca1053c9a91` against main `d3c8d5039`. Subsequent commits contain evidence and whitespace normalization only. This is the implementing session's review, not a fresh independent model review.

## What it does

The eval CLI validates an optional context window, passes it through the existing provider model declaration for the chief model, and records the declaration on scored and error rows. Learn cases reject the option because they use a different execution path.

## Good

The existing shared provider schema already accepts positive integer context windows. The daemon materializer already applies per-model declarations over its defaults. The change supplies the missing declaration through those interfaces without a second provider path or new dependency. The two runtime controls observe actual model files during HTTP requests and compare result-row metadata. Omitting the option leaves defaults unchanged.

## Bad

No introduced correctness issue found after checking CLI validation, case selection, model declaration, result/error serialization, and test cleanup. The existing resume mechanism skips completed `(case, repetition)` rows independently of model options. Use a fresh results directory for a changed context setting; existing rows do not gain the new metadata. The separate qualification verifier rejects missing metadata.

## Ugly

No new credential, authentication, or process-control path is introduced. The existing model selection requires an appropriate chief model in the roster; the change does not repair or expand that contract. A declared model window is configuration, not proof of a provider's actual capacity. The local stub evidence supports only configuration propagation.

## Tests

The source commit passed 107 tests across the CLI integration, daemon configuration, and approval-path suites. Its prepush passed 26 checks, including lint, typecheck, spec parsing, related integration tests, and affected-web selection. The selection found no browser E2E surface. Two old-code controls failed before implementation. The recorded outputs and model files are stored beside this review. A clarity pass found no useful simplification that justified changing the tested source.

Implementation verdict: pass within the stated scope. Fresh independent review and the parent issue's real-model case qualification are not established by this review.
