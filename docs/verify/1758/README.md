# PR 1787 verify

## delivery-metrics.test.mjs
# tests 23
# suites 0
# pass 23
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 164.291769

## lessons-ledger-gate
lessons ledger ok

## ci.yml self-test includes delivery-metrics
423:          node --test scripts/baseline-ratchet-gate.test.mjs scripts/gardener-weekly.test.mjs scripts/doc-drift.test.mjs scripts/evidence-prune.test.mjs scripts/delivery-metrics.test.mjs

## gardener-weekly runs delivery metrics
72:      - name: Delivery metrics weekly (#1758)
76:          node scripts/delivery-metrics.mjs --out docs/metrics --comment --ticket 1717
82:          name: delivery-metrics
