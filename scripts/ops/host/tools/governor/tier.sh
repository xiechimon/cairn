#!/bin/bash
# tier.sh <issue>  -> simple|medium|hard|none   ;  tier.sh env <issue> <implement|review|fix1|fix2>  -> env assignments
# Tiers come from ~/.local/state/overnight/tier/<n>, else from the tier= in the issue's acceptance-checklist marker; untiered tickets are not dispatched.
T=~/.local/state/overnight/tier
tier(){
  [ -s $T/$1 ] && { cat $T/$1; return; }
  t=$(gh issue view $1 -R xiechimon/cairn --json comments --jq '.comments[].body' 2>/dev/null | grep -oE '<!-- acceptance-checklist v1 tier=(simple|easy|medium|hard)' | tail -1 | sed -E 's/.*tier=//; s/easy/simple/')
  [ -n "$t" ] && { echo $t > $T/$1; echo $t; } || echo none
}
if [ "$1" = env ]; then
  t=$(tier $2)
  case "$3:$t" in
    implement:hard|fix2:*) echo "AI_ROUTE_PREFER=codex" ;;
    implement:*|fix1:*)    echo "AI_ROUTE_PREFER=pi AI_ROUTE_PREFER_MODEL=glm-5.3" ;;
    review:simple)         echo "AI_ROUTE_PREFER=pi AI_ROUTE_PREFER_MODEL=deepseek-v4.1-flash" ;;
    review:medium)         echo "AI_ROUTE_PREFER=codex" ;;
    review:hard)           echo "AI_ROUTE_PREFER=pi AI_ROUTE_PREFER_MODEL=glm-5.3" ;;
    review:*)              echo "AI_ROUTE_PREFER=codex" ;;
  esac
  exit 0
fi
tier $1
