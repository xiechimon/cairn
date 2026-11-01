#!/bin/bash
set -uo pipefail
n=$1; own=${2:-}
linked=$(gh issue view "$n" -R xiechimon/cairn --json closedByPullRequestsReferences --jq '.closedByPullRequestsReferences[].number') || { echo unknown; exit 0; }
other=$(printf '%s\n' "$linked" | grep -vx "${own:-none}" | grep -m1 .) || exit 1
echo "$other"
