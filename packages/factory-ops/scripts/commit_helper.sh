#!/usr/bin/env bash
set -euo pipefail

ISSUE_NUMBER=""
TITLE=""
RUN_ID=""
SESSION_ID=""
LEARNINGS=""
ALLOW_MAIN="false"
GOAL_NUMBER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue-number) ISSUE_NUMBER="${2:-}"; shift 2 ;;
    --title) TITLE="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --session-id) SESSION_ID="${2:-}"; shift 2 ;;
    --learnings) LEARNINGS="${2:-}"; shift 2 ;;
    --allow-main) ALLOW_MAIN="${2:-}"; shift 2 ;;
    --goal-number) GOAL_NUMBER="${2:-}"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$TITLE" ]]; then
  echo "--title is required" >&2
  exit 2
fi

if [[ -n "$ISSUE_NUMBER" ]] && ! [[ "$ISSUE_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "--issue-number must be numeric" >&2
  exit 2
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$ALLOW_MAIN" != "true" && "$branch" == "main" ]]; then
  echo "Refusing to commit on main (set --allow-main true to override)" >&2
  exit 2
fi

if [[ -z "$SESSION_ID" ]]; then
  # Auto-detect PI/Hatch session path deterministically when possible.
  # Worktree handler stores sessions under:
  #   .hatch/runs/<run_id>/sessions/<sanitized-branch>
  if [[ -n "$RUN_ID" ]]; then
    safe_branch=$(printf '%s' "$branch" | sed 's/[^a-zA-Z0-9_-]/_/g')
    candidate=".hatch/runs/${RUN_ID}/sessions/${safe_branch}"
    if [[ -d "$candidate" ]]; then
      SESSION_ID="$candidate"
    else
      # Fallback: best-effort most recent session directory for this run.
      latest=$(find ".hatch/runs/${RUN_ID}/sessions" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort | tail -n 1 || true)
      SESSION_ID="${latest:-.hatch/runs/${RUN_ID}/sessions/unknown}"
    fi
  else
    SESSION_ID="unknown"
  fi
fi

if [[ -n "$LEARNINGS" ]]; then
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  {
    echo ""
    echo "## ${ts}"
    echo "- Branch: ${branch}"
    if [[ -n "$ISSUE_NUMBER" ]]; then
      echo "- Issue: #${ISSUE_NUMBER}"
    fi
    echo "- Directive: ${LEARNINGS}"
  } >> AGENT-LEARNINGS.md
fi

git add -A

if git diff --cached --quiet; then
  echo "No staged changes to commit."
  exit 0
fi

msg=""
if [[ -n "$GOAL_NUMBER" && -n "$ISSUE_NUMBER" ]]; then
  msg+="feat(goal-${GOAL_NUMBER}): ${TITLE} (Closes #${ISSUE_NUMBER})\n\n"
elif [[ -n "$ISSUE_NUMBER" ]]; then
  msg+="fix: ${TITLE} (#${ISSUE_NUMBER})\n\n"
  msg+="Closes #${ISSUE_NUMBER}\n"
else
  msg+="chore: ${TITLE}\n\n"
fi
msg+="Hatch-Branch: ${branch}\n"
if [[ -n "$RUN_ID" ]]; then
  msg+="Hatch-Run: ${RUN_ID}\n"
fi
msg+="PI-Session: ${SESSION_ID}\n"

if ! output=$(git commit -q -m "$msg" 2>&1); then
  printf '%s\n' "$output" >&2
  exit 1
fi

echo "Committed on ${branch}."
