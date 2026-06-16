#!/bin/bash
# grok-auto-suggest.sh
#
# Example PostToolUse / UserPromptSubmit style hook (or inspiration).
# When certain high-uncertainty or high-value patterns are detected inside an active sptflo mission,
# it can suggest (or in aggressive mode, prepare) routing via /grok-spawn or best-of-n through Logos.

set -euo pipefail

# This is a sketch. Real implementation would inspect the last tool result, prompt, or git diff.

MISSION_STATE=".spt/swarm-state.json"

if [[ ! -f "$MISSION_STATE" ]]; then
  exit 0
fi

MISSION_ID=$(jq -r '.mission_id // empty' "$MISSION_STATE" 2>/dev/null || true)

if [[ -z "$MISSION_ID" ]]; then
  exit 0
fi

# Very simple heuristic example — expand this dramatically in reality
LAST_PROMPT_LOWER=$(echo "${CLAUDE_LAST_PROMPT:-}" | tr '[:upper:]' '[:lower:]')

SUGGEST=0
SUGGEST_REASON=""

if echo "$LAST_PROMPT_LOWER" | grep -qE "(best of|multiple options|explore.*approach|trade.?off|architecture|risk|invariant|security surface)"; then
  SUGGEST=1
  SUGGEST_REASON="high-uncertainty / option generation / adversarial work"
fi

if [[ $SUGGEST -eq 1 ]]; then
  echo ""
  echo "🧠 [grok-auto-suggest] This looks like a strong candidate for Grok participation in the current mission ($MISSION_ID)."
  echo "   Suggested action: /grok-spawn grok-reasoner \"...\"  or  /grok-best-of-n 5 \"...\""
  echo "   Reason: $SUGGEST_REASON"
  echo ""
fi

exit 0