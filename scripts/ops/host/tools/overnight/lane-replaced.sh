#!/bin/bash
set -uo pipefail
n=$1; own=${2:-}
issue=$(gh issue view "$n" -R xiechimon/cairn --json state,closedByPullRequestsReferences --jq '.state, .closedByPullRequestsReferences[].number') || { echo unknown; exit 0; }
[ "$(printf '%s\n' "$issue" | head -1)" = OPEN ] || { echo closed; exit 0; }
other=$(printf '%s\n' "$issue" | tail -n +2 | grep -vx "${own:-none}" | grep -m1 .) || exit 1
echo "$other"
