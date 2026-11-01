#!/bin/bash
# Renders a worker prompt with stub gh/node/pnpm/npx: the prompt must stay under 50KB and rendering must not run anything but gh.
set -u
t=$(mktemp -d); trap 'rm -rf $t' EXIT
for c in node pnpm npx vitest git ai-route; do printf '#!/bin/sh\necho ran >> %s/executed\n' "$t" > $t/$c; chmod +x $t/$c; done
printf '#!/bin/sh\ncase "$*" in *title*) echo "stub title";; *) echo "stub body";; esac\n' > $t/gh; chmod +x $t/gh
PATH="$t:$PATH" EXTRA_NOTE='note with `backticks` and $(echo SHOULD_NOT_RUN)' ~/lanes/build-prompt.sh 999999 || { echo "FAIL: build-prompt exited non-zero"; exit 1; }
f=/tmp/issue-999999.txt; size=$(wc -c < $f); rm -f $f.keep; cp $f $t/out; rm -f $f
[ -e $t/executed ] && { echo "FAIL: rendering the prompt executed a command"; exit 1; }
[ "$size" -lt 50000 ] || { echo "FAIL: prompt is $size bytes (limit 50KB)"; exit 1; }
grep -q 'SHOULD_NOT_RUN' $t/out && grep -q '`gh pr list' $t/out || { echo "FAIL: literal text was expanded"; exit 1; }
echo "ok: prompt $size bytes, nothing executed"
