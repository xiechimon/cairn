#!/bin/bash
set -e
n=$1
root=${TMPDIR:-$HOME/.cache/lane-tmp}
mkdir -p -- "$root"
t=$(gh issue view $n -R xiechimon/cairn --json title --jq .title)
{ sed "s/__N__/$n/g" ~/lanes/prompts/implement-head.txt; echo; echo "# $t"; echo; gh issue view $n -R xiechimon/cairn --json body --jq .body; [ -n "${EXTRA_NOTE:-}" ] && printf '\n\n%s\n' "$EXTRA_NOTE"; true; } > "$root/issue-$n.txt"
