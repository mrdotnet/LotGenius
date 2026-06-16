#!/bin/bash
# grok-mission-link.sh
#
# Example hook (or inspiration for one) that can be wired into sptflo / Logos flows.
#
# When an active sptflo mission is detected, this can be used to:
# - Enrich environment with current mission_id for any Grok bridge calls
# - Suggest to the user / orchestrator that certain high-uncertainty or best-of-n friendly tasks could be routed via Logos + Grok
#
# This is a starting point. Real wiring would live in the sptflo-daemon bridge substrate or in Logos coordination hooks.

set -euo pipefail

MISSION_STATE_FILE=".spt/swarm-state.json"

if [[ -f "$MISSION_STATE_FILE" ]]; then
  MISSION_ID=$(jq -r '.mission_id // empty' "$MISSION_STATE_FILE" 2>/dev/null || true)
  PHASE=$(jq -r '.phase // empty' "$MISSION_STATE_FILE" 2>/dev/null || true)

  if [[ -n "$MISSION_ID" ]]; then
    export SPTFLO_ACTIVE_MISSION="$MISSION_ID"
    export SPTFLO_ACTIVE_PHASE="$PHASE"

    # Optional: log that we're in a mission context when Grok work might happen
    # echo "[grok-mission-link] Active mission $MISSION_ID (phase: $PHASE)" >&2
  fi
fi

# Future enhancement ideas:
# - On certain PostToolUse patterns (large refactors, new architecture, heavy uncertainty), emit a suggestion:
#   "This looks like a good candidate for /grok-spawn grok-reasoner or /grok-best-of-n inside the current mission."
#
# - Before a major phase gate, check for any open Grok delegations linked to this mission and surface them to Castellan.

exit 0