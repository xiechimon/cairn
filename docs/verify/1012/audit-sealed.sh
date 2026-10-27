#!/usr/bin/env bash
# #1012 sealed-version ledger audit — rerunnable in-tree audit (shape of #953's
# audit-terminal-state.py). Tracker-level facts (issue states, #980 body rows,
# #909 abdication comment) live on GitHub and are checked in the README's
# audit record; everything machine-decidable inside the tree is checked here.
#
#   bash docs/verify/1012/audit-sealed.sh   # rc=0 = every check holds
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
fails=0
check() { # check <name> <rc>
  if [ "$2" -eq 0 ]; then echo "PASS  $1"; else echo "FAIL  $1"; fails=$((fails+1)); fi
}

echo "== gate sweep (the #989-era surface + the two #851 gates kept by ruling) =="
for g in ui-registry-gate ui-debt-gate ui-drift-gate ui-consumer-shape-gate ui-dead-class-gate; do
  node "scripts/$g.mjs" >/dev/null 2>&1
  check "scripts/$g.mjs" $?
done

echo
echo "== hash ledger terminal counts (#989 gate face) =="
# 33 files in components/ui = 26 registry (19 pristine / 7 deviated) + 7 adapters
node scripts/ui-registry-gate.mjs 2>/dev/null | grep -q '33 file(s) in apps/web/src/components/ui = 26 registry (19 pristine vs pinned snapshot / 7 registered deviations) + 7 adapters'
check "ledger: 33 = 26 registry (19 pristine / 7 deviated) + 7 adapters" $?

echo
echo "== debt baseline at the floor =="
python3 - <<'PY'
import json, sys
b = json.load(open('scripts/ui-debt-baseline.json'))
pf = b['perFaceCss']
rc = b['rawControls']
ok = len(pf) == 0 and rc['total'] == 3
print(f"perFaceCss entries={len(pf)} rawControls.total={rc['total']}")
sys.exit(0 if ok else 1)
PY
check "debt baseline: 0 per-face css files, 3 bare controls (all deliberate-native)" $?

echo
echo "== canon annotations (#1013 / ADR 0012 / spec-22 face) =="
grep -q 'superseded-in-part（2026-10-07，ADR 0012 / '"#"'980）' docs/spec/22*.md
check "spec/22 superseded-in-part header (ADR 0012 / #980)" $?
grep -q 'superseded-in-part（2026-10-08，ADR 0012 / '"#"'991 Q9 / '"#"'1013）' docs/adr/0009*.md
check "ADR 0009 D3(ii) superseded-in-part header (#1013)" $?
grep -q '^## 修订' docs/adr/0012*.md
check "ADR 0012 revision section present" $?
grep -q '#991 Q9' docs/adr/0012*.md && grep -q '#991 Q10' docs/adr/0012*.md
check "ADR 0012 revision closes #991 Q9 + Q10" $?
grep -q 'superseded-in-part（2026-10-08，'"#"'1013 / '"#"'991 Q13 余册核账）' docs/spec/06*.md
check "spec/06 superseded-in-part header (#1013)" $?
grep -q 'superseded-in-part（2026-10-08，ADR 0012 / '"#"'980 / '"#"'1013 增补）' docs/spec/11*.md
check "spec/11 stacked superseded header (#1013)" $?
grep -q '余册核账封口（2026-10-08，'"#"'1013 / '"#"'991 Q13）' docs/spec/18*.md
check "spec/18 audit-closure header (#1013)" $?

echo
echo "== #851 gate ruling landed in CI config (#1012) =="
grep -q '#1012 封版裁决：保留' .github/workflows/ci.yml
check "ci.yml debt-gate comment carries the #1012 keep ruling" $?
grep -q '#1012 封版裁决：保留为永久闸' .github/workflows/ci.yml
check "ci.yml drift-gate comment carries the #1012 keep ruling" $?
grep -q 'sealed as a standing regression gate by #1012' scripts/ui-debt-gate.mjs
check "ui-debt-gate.mjs header carries the sealed status" $?

echo
echo "== hand-written shells stay retired (#983 verdict table + #1010) =="
for f in floating-shell.tsx kbd-hint.tsx; do
  [ ! -e "apps/web/src/components/ui/$f" ]
  check "components/ui/$f absent" $?
done
! find apps/web/src -iname '*clickcatter*' | grep -q .
check "ClickCatcher absent from apps/web/src" $?
# select.tsx is the 9th item, retired by #1010: present but as a pristine registry file
python3 - <<'PY'
import json, sys
files = json.load(open('scripts/ui-registry.json'))['files']
adapters = sorted(k for k, e in files.items() if e['kind'] == 'adapter')
registry = [k for k, e in files.items() if e['kind'] == 'registry']
expected = ['alert-dialog-shell.tsx', 'dialog-shell.tsx', 'panel.tsx',
            'seeded-avatar.tsx', 'status-chip.tsx', 'tag-chip.tsx', 'toaster.tsx']
print(f"registry={len(registry)} adapters={adapters}")
sys.exit(0 if adapters == expected and len(registry) == 26 and len(files) == 33 else 1)
PY
check "ledger: 33 files = 26 registry + the 7 frozen zero-skin adapters" $?

echo
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASS"; else echo "$fails CHECK(S) FAILED"; fi
exit $((fails > 0))
