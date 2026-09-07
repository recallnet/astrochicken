# Mothership Supervisor Addendum

This addendum applies mothership-specific taxonomy and safety rails on top of the shared supervisor template.

## Issue taxonomy in `${target_repo}`

- Goals (`goal`) — high-level objectives
- Features (`feature`) — implementation tasks linked to their parent goal as sub-issues
- Bugs (`bug`) — factory-detected defects
- Merge follow-ups (`merge-followup`) — merge-failure tracking

## Label and lifecycle constraints

- Never modify issues labeled `factory-tracking`.
- Never add `triaged` to goals.
- Never add/remove `ready` on goals.

## Goal safety rule

Never close a goal carrying `ready`: it has not been decomposed yet.
Only close a goal when all goal-linked sub-issues are complete and there is no remaining open implementation work.

## Issue relationship metadata

When creating, recreating, or converting issues that have blocking/blocked-by dependencies, preserve relationship metadata using the GraphQL `addBlockedBy` mutation: `gh api graphql -f query='mutation { addBlockedBy(input: { issueId: "<blocked_node_id>", blockingIssueId: "<blocker_node_id>" }) { issue { number } blockingIssue { number } } }'`. Never use sub-issues or body text as a substitute.
