export const OPS_CLI_USAGE = `Usage:
  # Canonical form
  node packages/factory-ops/src/cli.ts <domain> <operation> [...flags]
  # Legacy DOT prompts using "run --op" are rewritten by Hatch tool runtime.

  node packages/factory-ops/src/cli.ts common resolve-gh-repo [--gh-repo <owner/repo>]  # precedence: --gh-repo > HATCH_TARGET_REPO/TARGET_REPO > HATCH_TARGET_REPO/TARGET_REPO/HATCH_GH_REPO/GH_REPO/MOTHERSHIP_REPO > resolved factory context
  node packages/factory-ops/src/cli.ts common resolve-factory-config --key <key> [--fallback <value>] [--factory-root <path>] [--factory-config-path <path>] [--factory-id <id>] [--repo <owner/repo>] [--control-plane-repo <owner/repo>] [--scenarios-root <path>] [--config-path <path>]  # resolves config from active factory context (or explicit --factory-config-path/--config-path override); for key K: HATCH_<K_UPPER> > config value > fallback
  node packages/factory-ops/src/cli.ts common resolve-goal-decomposition-timeout --stage <issue_draft|issue_repair|issue_judge|issue_revise|triage_plan|triage_repair> [--factory-root <path>] [--factory-config-path <path>] [--factory-id <id>] [--repo <owner/repo>] [--control-plane-repo <owner/repo>] [--scenarios-root <path>] [--config-path <path>]  # resolves capabilities.goal_decomposition.timeouts.<stage> override or capability defaults artifact
  node packages/factory-ops/src/cli.ts common load-agent-guidance-context [--repo-root .] [--agents-path AGENTS.md] [--agent-learnings-path AGENT-LEARNINGS.md] [--agents-max-chars 12000] [--learnings-max-chars 12000] [--learnings-entry-count 5]
  node packages/factory-ops/src/cli.ts llm route list [--repo-root .] [--inventory-path <path>] [--json]
  node packages/factory-ops/src/cli.ts llm route inspect --path-id <id> [--repo-root .] [--inventory-path <path>] [--json]
  node packages/factory-ops/src/cli.ts llm route diff [--path-id <id>] [--repo-root .] [--inventory-path <path>] [--baseline-inventory-path <path>] [--json]
  node packages/factory-ops/src/cli.ts common normalize-approved --value <raw>
  node packages/factory-ops/src/cli.ts common normalize-decision --value <raw>
  node packages/factory-ops/src/cli.ts common validate-issue-spec-draft ([--issue-spec '<json>' | --issue-spec-b64 <base64>] [--feature '<json>' | --feature-b64 <base64>])
  node packages/factory-ops/src/cli.ts common increment-counter --value <raw>
  node packages/factory-ops/src/cli.ts common build-retry-signal --decompose-parse-status <status> [--decompose-parse-error <error>] [--decompose-attempts <n>]
  node packages/factory-ops/src/cli.ts common count-json [--raw '[...]' | --raw-b64 <base64>]  # reads JSON stdin when flags are omitted
  node packages/factory-ops/src/cli.ts common count-feature-objects [--raw '[...]' | --raw-b64 <base64>]  # reads JSON stdin when flags are omitted
  node packages/factory-ops/src/cli.ts common inspect-json ([--raw '<json>' | --raw-b64 <base64>] [--file <path>])  # reads JSON stdin when --raw/--raw-b64 are omitted
  node packages/factory-ops/src/cli.ts common fallback-json ([--raw '<json>' | --raw-b64 <base64>] [--file <path>] [--goal-number <n>] [--goal-title <title>])  # reads JSON stdin when --raw/--raw-b64 are omitted
  node packages/factory-ops/src/cli.ts common inspect-json-pair ([--primary '<json>' | --primary-b64 <base64>] [--secondary '<json>' | --secondary-b64 <base64>])  # reads primary JSON from stdin when --primary/--primary-b64 are omitted
  node packages/factory-ops/src/cli.ts common fallback-json-pair ([--primary '<json>' | --primary-b64 <base64>] [--secondary '<json>' | --secondary-b64 <base64>])  # reads primary JSON from stdin when --primary/--primary-b64 are omitted
  node packages/factory-ops/src/cli.ts common fallback-issue-spec ([--issue-spec '<json>' | --issue-spec-b64 <base64>] [--feature '<json>' | --feature-b64 <base64>])  # reads issue spec JSON from stdin when --issue-spec/--issue-spec-b64 are omitted
  node packages/factory-ops/src/cli.ts common fallback-issue-spec-bundle ([--issue-spec '<json>' | --issue-spec-b64 <base64>] [--feature '<json>' | --feature-b64 <base64>])  # returns issue_spec plus issue_spec_b64
  node packages/factory-ops/src/cli.ts common normalize-feature-issue-spec ([--issue-spec '<json>' | --issue-spec-b64 <base64>] [--feature '<json>' | --feature-b64 <base64>])  # coerces goal decomposition issue specs to feature/ready labels
  node packages/factory-ops/src/cli.ts common normalize-feature-issue-spec-bundle ([--issue-spec '<json>' | --issue-spec-b64 <base64>] [--feature '<json>' | --feature-b64 <base64>])  # returns normalized issue_spec plus issue_spec_b64
  node packages/factory-ops/src/cli.ts common normalize-issue-urls [--raw '[...]' | --raw-b64 <base64>]  # trims, validates, and de-duplicates GitHub issue URLs
  node packages/factory-ops/src/cli.ts common create-issue --repo <owner/repo> [--issue-spec '<json>' | --issue-spec-b64 <base64>]  # reads issue spec JSON from stdin when payload flags are omitted
  node packages/factory-ops/src/cli.ts common update-issue --repo <owner/repo> --issue-url <issue-url> [--issue-spec '<json>' | --issue-spec-b64 <base64>]  # reads issue spec JSON from stdin when payload flags are omitted
  node packages/factory-ops/src/cli.ts judge build-evidence-contract [--judge-kind <name>] [--judge-context '{...}' | --judge-context-b64 <base64>] [--worktree-dir <path>] [--subject-id <id>] [--require-qa-markers true|false]
  node packages/factory-ops/src/cli.ts judge build-context-contract [--judge-kind <name>] [--judge-context '{...}' | --judge-context-b64 <base64>] [--scenario-selector <scope/domain|...>] [--scenario-context <name>] [--scope <name>] --judge-evidence-path <path> --judge-evidence-sha256 <sha256> [--scenario-registry-root <path>] [--objective-id <id>] [--judge-rubric <id>] [--subject-id <id>] [--issue-number <n>] [--goal-number <n>] [--milestone-title <title>] [--gh-repo <owner/repo>] [--worktree-dir <path>]
  node packages/factory-ops/src/cli.ts judge validate-context-contract [--judge-kind <name>] [--judge-context '{...}' | --judge-context-b64 <base64>] --judge-context-path <path> --judge-context-sha256 <sha256> [--scenario-selector <scope/domain|...>] [--scenario-context <name>] [--scope <name>] --judge-evidence-path <path> --judge-evidence-sha256 <sha256> [--judge-context-valid <true|false>] [--judge-context-error <code>] [--scenario-registry-root <path>] [--objective-id <id>] [--judge-rubric <id>]
  node packages/factory-ops/src/cli.ts judge validate-evidence-contract [--judge-kind <name>] [--judge-context '{...}' | --judge-context-b64 <base64>] --judge-evidence-path <path> --judge-evidence-sha256 <sha256> [--judge-evidence-valid <true|false>] [--judge-evidence-error <code>] [--require-qa-markers true|false]
  node packages/factory-ops/src/cli.ts retry profile [--runs-dir .hatch/runs] [--last 30] [--pipeline wave_execute] [--format json|md] [--compare true --baseline-last 30]
  node packages/factory-ops/src/cli.ts wave filter-ready-issues --repo <owner/repo> [--milestone-issues '[...]' | --milestone-issues-b64 <base64>]  # reads milestone issue JSON from stdin when payload flags are omitted
  node packages/factory-ops/src/cli.ts goal-run split-results [--run-id <id>] [--runs-dir .hatch/runs] [--fallback '[...]' | --fallback-b64 <base64>]  # when no --run-id and no fallback flags are provided, reads impl_results JSON from stdin
  node packages/factory-ops/src/cli.ts wave check-control-plane-blocker --repo <owner/repo> --issue <n>
  node packages/factory-ops/src/cli.ts wave dispatch-select --repo <owner/repo> [--max-concurrent 1] (--milestones '[...]' --ready-issues '[...]' --priorities-issue '[...]' | --milestones-b64 <base64> --ready-issues-b64 <base64> --priorities-issue-b64 <base64>)
  node packages/factory-ops/src/cli.ts wave create-ready --repo <owner/repo> --selected-waves '[...]'
  node packages/factory-ops/src/cli.ts wave find-ready --repo <owner/repo> [--runs-dir .hatch/runs] [--stale-run-minutes 20]
  node packages/factory-ops/src/cli.ts goal-run handle-review-failures --repo <owner/repo> [--review-failures '[...]' | --review-failures-b64 <base64>] [--run-id <id>] [--pipeline <name>] [--mode goal_execute|issue_execution]  # reads review-failures JSON from stdin when payload flags are omitted
  node packages/factory-ops/src/cli.ts wave sanitize-state --repo <owner/repo> [--apply true|false] [--dry-run true|false] [--runs-dir .hatch/runs] [--stale-run-minutes 20] [--run-id <id>] [--pipeline <name>]
  node packages/factory-ops/src/cli.ts wave claim-ready --repo <owner/repo> --issue <n> --milestone-title <title> [--run-id <id>] [--pipeline <name>]
  node packages/factory-ops/src/cli.ts wave release-claim --repo <owner/repo> --issue <n> --milestone-title <title> [--reason <txt>] [--run-id <id>] [--pipeline <name>] [--remove-label true|false]
  node packages/factory-ops/src/cli.ts wave block-ready --repo <owner/repo> --issue <n> --milestone-title <title> [--reason judge_failed|no_merge_candidates] [--run-id <id>] [--pipeline <name>]
  node packages/factory-ops/src/cli.ts wave claim-diagnostics [--now-epoch-ms <ms>]
  node packages/factory-ops/src/cli.ts wave lock-ready --repo <owner/repo> --issue <n> --milestone-title <title> [--claim-token <token>] [--claim-owner-id <id>] [--claim-run-id <id>]
  node packages/factory-ops/src/cli.ts wave complete-ready --repo <owner/repo> --issue <n> [--claim-token <token>] [--claim-owner-id <id>] [--claim-run-id <id>]
  node packages/factory-ops/src/cli.ts goal-run check-merge-candidates --merge-candidates '[...]'
  node packages/factory-ops/src/cli.ts goal-run close-merged-issues --repo <owner/repo> --merge-candidates '[...]' [--run-id <id>] [--goal-number <n>]
  node packages/factory-ops/src/cli.ts goal-run build-merge-results --merge-candidates '[...]' --merge-status <merged|already_merged|failed> [--merge-notes <txt>] [--merge-resolver <deterministic|llm|unknown>] [--path-taken <name>]
  node packages/factory-ops/src/cli.ts goal-run fallback-judge --judge-pass <true|false> [--judge-notes <txt> | --judge-notes-b64 <base64>] --error <code>
  node packages/factory-ops/src/cli.ts merge extract-item --item '{...}'
  node packages/factory-ops/src/cli.ts merge resolve-context --merge-candidates '[...]' [--fallback-branch <name>] [--fallback-worktree-dir <path>]
  node packages/factory-ops/src/cli.ts merge rebase --repo <abs/repo> --branch <name> [--worktree-dir <path>]
  node packages/factory-ops/src/cli.ts merge attempt --repo <abs/repo> --branch <name>
  node packages/factory-ops/src/cli.ts merge push-main --repo <abs/repo> [--branch main] [--remote origin]
  node packages/factory-ops/src/cli.ts merge build-conflict-packet --repo <abs/repo> --branch <name> --issue <n> [--merge-stderr <txt>] [--worktree-dir <path>]
  node packages/factory-ops/src/cli.ts merge verify-resolution --repo <abs/repo> --branch <name> [--worktree-dir <path>]
  node packages/factory-ops/src/cli.ts merge verify-push-resolution --repo <abs/repo> [--branch main] [--remote origin]
  node packages/factory-ops/src/cli.ts merge run-integration --repo <abs/repo> [--integration-command '<cmd>' | --integration-command-b64 <base64>]
  node packages/factory-ops/src/cli.ts merge report --issue <n> --branch <name> --merge-status <merged|already_merged|failed> [--merge-resolver <deterministic|llm|unknown>] [--path-taken <name>] [--notes <txt> | --notes-b64 <base64>] [--integration-result '{...}' | --integration-result-b64 <base64>]
  node packages/factory-ops/src/cli.ts merge emit-resolution-failure --recurrence-key <key> [--resolution-notes <txt>] [--resolution-check <txt>] [--branch <name>] [--issue <n>] [--run-id <id>] [--factory-id <id>] [--runs-dir <path>]
  node packages/factory-ops/src/cli.ts merge run-count --recurrence-key <key> [--lookback-hours 24] [--factory-id <id>] [--runs-dir <path>]
  node packages/factory-ops/src/cli.ts goal-issue extract [--item '{...}' | --item-b64 <base64>]  # reads item JSON from stdin when payload flags are omitted
  node packages/factory-ops/src/cli.ts goal-issue fetch-body --repo <owner/repo> --issue <n>
  node packages/factory-ops/src/cli.ts goal-issue init --issue <n> --repo <abs/repo> [--branch <name>] [--worktree-dir <path>]
  node packages/factory-ops/src/cli.ts goal-issue inspect-existing --worktree-dir <path>
  node packages/factory-ops/src/cli.ts goal-issue inspect-changes --worktree-dir <path>
  node packages/factory-ops/src/cli.ts goal-issue resolve-mode --mode <full|smoke>   # Allowed: full|smoke; any non-smoke value follows full-mode path (no hard failure)
  node packages/factory-ops/src/cli.ts goal-issue decide-existing-reuse --branch <name> --existing-commits <n>
  node packages/factory-ops/src/cli.ts goal-issue impl-result --issue <n> --branch <name> --worktree-dir <path> --review-failed <true|false> --review-notes <txt> [--disposition <done_elsewhere|not_done|enhancement_only|uncertain>] [--decision-confidence <low|medium|high>] [--zero-delta-retry <true|false>] [--zero-delta-retry-count <n>]
  node packages/factory-ops/src/cli.ts goal-issue evaluate-done-elsewhere [--review-evidence-path <path>] [--worktree-dir <path>] [--issue <n>]
  node packages/factory-ops/src/cli.ts goal-issue write-review-evidence --worktree-dir <path> --repo <owner/repo|abs/repo> --issue <n> --branch <name> [--review-qa-command <cmd>] [--integration-command <cmd>] [--builder-notes-b64 <base64>]
  node packages/factory-ops/src/cli.ts goal-issue read-zero-delta --worktree-dir <path> --issue <n>
  node packages/factory-ops/src/cli.ts goal-issue validate-zero-delta --review-evidence-path <path> [--worktree-dir <path>] [--issue <n>] [--branch <name>]
  node packages/factory-ops/src/cli.ts goal-issue zero-delta-status --issue <n> [--worktree-dir <path>] [--review-evidence-path <path>] [--branch <name>]   # emits retry + evidence summary; exits 2 with deterministic error when zero-delta state or evidence is missing
  node packages/factory-ops/src/cli.ts goal-issue rerun-review-qa --review-evidence-path <path> [--worktree-dir <path>] [--repo <owner/repo|abs/repo>]
  node packages/factory-ops/src/cli.ts goal-issue build-review-context --worktree-dir <path> --issue <n> --review-evidence-path <path> [--branch <name>] [--repo-policy-path <path>] [--skill-policy-path <path>]
  node packages/factory-ops/src/cli.ts goal-issue validate-review-context --review-context-path <path> --review-context-sha256 <sha256> [--review-context-valid <true|false>] [--review-context-error <code>]
  node packages/factory-ops/src/cli.ts goal-issue verify-visual-refinement-evidence --repo <owner/repo> --issue <n> --review-context-path <path> --review-evidence-path <path> [--review-context-gate-pass <true|false>] [--review-context-gate-code <code>] [--scenario-root <path>] [--factory-root <path>]
  node packages/factory-ops/src/cli.ts goal-issue resolve-review-route --review-verdict <approve|revise|other> [--review-context-gate-pass <true|false>] [--review-context-gate-code <code>] [--review-context-error <code>] [--review-context-path <path>] [--review-notes <txt>]
  node packages/factory-ops/src/cli.ts goal-issue review-verdict-inspect --run-id <id> [--runs-dir .hatch/runs]
  node packages/factory-ops/src/cli.ts milestone resolve-goal-number --milestone-title <title>
  node packages/factory-ops/src/cli.ts milestone next-issue --repo <owner/repo> --milestone-title <title> [--completed '["1","2"]'] [--processed '["1"]'] [--max-issues <n>] [--candidate-limit <n>]
  node packages/factory-ops/src/cli.ts milestone accumulate --impl-results '[...]' --completed '[...]' --item '{...}'
  node packages/factory-ops/src/cli.ts milestone qa-infra-triage --issue <n> --branch <name> [--review-evidence-path <path>] [--repo <owner/repo|abs/repo>]   # absolute --repo paths are resolved to owner/repo via git origin for GH calls; when --review-evidence-path is omitted, discovery checks <cwd>/.hatch/review/<issue>.json, then <repo>/.hatch/review/<issue>.json for absolute repos, then ../.hatch-worktrees/<branch>/.hatch/review/<issue>.json; exits 0 when QA rerun passes; exits 2 when rerun remains blocked or evidence is missing
  node packages/factory-ops/src/cli.ts triage normalize-issues --issue-urls '[...]'
  node packages/factory-ops/src/cli.ts triage zip-features --approved-features '[...]' --issue-index '[...]'
  node packages/factory-ops/src/cli.ts triage apply-status --repo <owner/repo> --issue <n> --status <accept|blocked> [--blocked-by '[...]'] [--notes '<text>'] [--control-plane-blocker '<metadata>']
  node packages/factory-ops/src/cli.ts triage extract-item --item '{...}'
  node packages/factory-ops/src/cli.ts triage record-relationships --repo <owner/repo> --issue <n> [--parent <n>] [--blocking '[...]'] [--blocked-by '[...]']
  node packages/factory-ops/src/cli.ts triage sync-blocked-by --repo <owner/repo> --issue <n> [--blocked-by '[...]']
  node packages/factory-ops/src/cli.ts triage resolve-feature-dependencies --repo <owner/repo> --feature-issue-map '[...]'
  node packages/factory-ops/src/cli.ts triage apply-rejected-upstream --repo <owner/repo> --issue <n> [--blocker-ref <ref>]
  node packages/factory-ops/src/cli.ts goal list-ready --repo <owner/repo>
  node packages/factory-ops/src/cli.ts goal decompose-backpressure --repo <owner/repo> [--max-concurrent-goals <n>]
  node packages/factory-ops/src/cli.ts goal validate-decisions --goal-issues '[...]' --decisions '{...}'
  node packages/factory-ops/src/cli.ts goal apply-decisions --repo <owner/repo> [--decisions '[...]' | --decisions-b64 <base64>]  # reads decisions JSON from stdin when payload flags are omitted
  node packages/factory-ops/src/cli.ts goal filter-kept ([--issues '[...]' | --issues-b64 <base64>] [--decisions '[...]' | --decisions-b64 <base64>])  # reads issues JSON from stdin when --issues/--issues-b64 are omitted
  node packages/factory-ops/src/cli.ts goal check-decomposed --repo <owner/repo> --issue-number <n> [--repo-root .] [--factory-id <id>]
  node packages/factory-ops/src/cli.ts goal admission-check --repo-root . --goal-issue-number <n> --goal-execution-path <easy|medium|hard> --goal-routing-state '{"decomposition_state":"required|not_required|pending|running|completed|failed|blocked","planning_state":"required|not_required|pending|running|completed|failed|blocked"}' [--goal-labels '[{"name":"hard"}]'] [--hard-goal-state needs_planning|awaiting_post_plan_review|approved_plan_resume] [--hard-plan-packet-id <id>] [--hard-plan-artifact-refs '[...]'] [--factory-id <id>]
  node packages/factory-ops/src/cli.ts goal admission-fail --goal-issue-number <n> --goal-admission-decision <decision> --goal-admission-reason <reason> --goal-admission-error-code <code> [--decomposition-packet-present true|false] [--planning-locked true|false]  # emits deterministic admission-denied JSON and exits non-zero
  node packages/factory-ops/src/cli.ts goal duplicate-decompose-guard --repo <owner/repo> --issue-number <n> [--repo-root .] [--factory-id <id>] [--run-id <id>] [--pipeline <name>] [--node-id <name>]  # exits non-zero with goal_already_decomposed:<n>:operator_reset_required when decomposition already persisted
  node packages/factory-ops/src/cli.ts goal admission-reset --repo-root . --goal-issue-number <n> --reason <operator_reason> [--factory-id <id>]  # explicit operator reset path; supersedes decomposition + execution-path packets for this goal
  node packages/factory-ops/src/cli.ts goal compute-close-condition --issue-count <n> --triage-count <n> [--triage-plan '{...}']
  node packages/factory-ops/src/cli.ts goal final-state-review --repo <owner/repo> --goal-number <n>
  node packages/factory-ops/src/cli.ts goal auto-ready-artifacts --repo <owner/repo>
  node packages/factory-ops/src/cli.ts goal sanitize-duplicates --repo <owner/repo> [--run-id <id>] [--pipeline <name>] [--dry-run true|false]
  node packages/factory-ops/src/cli.ts goal persist-decomposition-packet --repo-root . [--goal-issue '{...}' | --goal-issue-b64 <base64>] [--goal-context '{...}' | --goal-context-b64 <base64>] [--approved-features '[...]' | --approved-features-b64 <base64>] [--issue-urls '[...]' | --issue-urls-b64 <base64>] [--goal-issue-number <n>] [--factory-id <id>] [--run-id <id>]
  node packages/factory-ops/src/cli.ts goal hard-plan attach --repo <owner/repo> --repo-root . --goal <n> --plan-id <id> --summary <text|path> [--summary-path <path>] [--artifact-refs '[...]' | --artifact-refs-b64 <base64>] [--artifact-refs-path <path>] [--plan-metadata '{...}' | --plan-metadata-b64 <base64> | --plan-metadata-path <path>] [--attached-by <id>] [--factory-id <id>] [--run-id <id>] [--pipeline <name>] [--node-id <name>] [--target-repo <owner/repo>] [--control-plane-repo <owner/repo>] [--hold-for-human-review true|false]  # persists goal_hard_plan_packet, upserts <!-- goal-hard-plan:v1 goal=<n> packet=<id> -->, and (default) removes ready + adds awaiting-human with <!-- goal-run:awaiting-review -->
  node packages/factory-ops/src/cli.ts goal hard-plan inspect --repo-root . --goal <n> [--factory-id <id>]  # inspects durable hard-plan packet linkage for a goal
  node packages/factory-ops/src/cli.ts goal materialize-approved-plan --repo-root . --repo <owner/repo> --goal-number <n> --plan-packet <id> --planning-artifact-path <path> [--factory-id <id>] [--run-id <id>] [--target-repo <owner/repo>] [--control-plane-repo <owner/repo>]  # deterministically materializes approved hard-plan features into child issues once, links sub-issues, syncs blockedBy, clears awaiting-human hold label, persists decomposition+materialization traceability, and reuses persisted results on replay
  node packages/factory-ops/src/cli.ts goal hard-state --repo <owner/repo> --repo-root . --goal-issue-number <n> [--goal-execution-path <easy|medium|hard>] [--goal-routing-state '{...}'] [--goal-labels '[{"name":"hard"}]'] [--factory-id <id>]  # deterministic hard-goal resolver emits needs_planning|awaiting_post_plan_review|approved_plan_resume plus canonical hard-plan artifact refs
  node packages/factory-ops/src/cli.ts goal build-fallback-features [--goal-issue '{...}' | --goal-issue-b64 <base64>] [--goal-number <n>]  # reads goal issue JSON from stdin when payload flags are omitted
  node packages/factory-ops/src/cli.ts goal emit-fallback-defect --fallback-node <node> [--pipeline goal_intake_decompose] [--run-id <id>] [--trigger-reason <reason>] [--classification <llm_output_malformed|llm_output_empty|pipeline_transport_defect|contract_violation|external_service_failure>] [--severity <high|medium>] [--approved <true|false>] [--decompose-parse-status <status>] [--pre-normalize-feature-count <n>] [--post-normalize-feature-count <n>] [--issues-created <n>] [--goal-issue-number <n>] [--runs-dir .hatch/runs] [--factory-id <id>]
  node packages/factory-ops/src/cli.ts goal validate-intake [--goal-issue '{...}' | --goal-issue-b64 <base64>]  # reads goal issue JSON from stdin when flags omitted; outputs "eligible" | "ineligible:closed" | "ineligible:not_goal"
  node packages/factory-ops/src/cli.ts artifact ingest --control-plane-repo <owner/repo> --source-repos <r1,r2> [--trusted-source-repos <r1,r2>] [--trusted-factory-ids <f1,f2>] [--max 20] [--dry-run true|false]
  node packages/factory-ops/src/cli.ts artifact emit-issue --repo <owner/repo> --factory-id <id> --run-id <id> --pipeline <name> --node <name> --kind <kind> --summary <txt> [--evidence <txt>] [--required-factory-release <x.y.z>]
  node packages/factory-ops/src/cli.ts artifact release-manifest --control-plane-repo <owner/repo> --source-repos <r1,r2> [--states closed|open|all] [--max 200] [--run-id <id>] [--release-sha <sha>] [--release-tag <tag>] [--changelog-summary <txt>] [--local-factory-release <x.y.z>] [--runs-dir .hatch/runs] [--releases-dir .hatch/releases] [--out-path <path>]  # fails closed on GH read/linkage errors
  node packages/factory-ops/src/cli.ts artifact emit-disposition-feedback --control-plane-repo <owner/repo> --manifest-path <path> [--dry-run]
  node packages/factory-ops/src/cli.ts research approve-stage --hypothesis-id <id> --stage hypothesis_formulation|feature_engineering_eda|backtesting|verification_red_team --approved true|false [--reviewer-id <id>] [--reviewer-note <txt>] [--approvals-dir .hatch/research/approvals]  # stage gate approval is durable; rerun research tick with context_path pointing at this approval JSON so the stage gate can rehydrate
  node packages/factory-ops/src/cli.ts research set-stage-label --repo <owner/repo> --hypothesis-issue <n> --stage hypothesis_formulation|data_infrastructure|feature_engineering_eda|strategy_design|backtesting|verification_red_team|synthesis
  node packages/factory-ops/src/cli.ts research set-approval-label --repo <owner/repo> --hypothesis-issue <n> --approved true|false --approval-context '{"stage_id":"backtesting"}'
  node packages/factory-ops/src/cli.ts research status --hypothesis-id <id> [--runs-dir .hatch/research/runs] [--repo <owner/repo>] [--hypothesis-issue <n>] [--run-id <id>] [--use-github true|false]
  node packages/factory-ops/src/cli.ts observability trace-artifact --control-plane-repo <owner/repo> --source-repo <owner/repo> --source-issue <n>
  node packages/factory-ops/src/cli.ts factory resume-gate --control-plane-repo <owner/repo> --source-repo <owner/repo> --source-issue <n> [--milestone-title <title>] [--rollout-channel stable|canary|pinned] [--policy-path <path> | --policy-json '{...}'] [--manifest-path <path>] [--manifest-ref <ref>] [--manifest-fetch-cmd '<cmd>'] [--local-factory-release <x.y.z>] [--local-factory-release-cmd '<cmd>'] [--self-update-cmd '<cmd>']
  node packages/factory-ops/src/cli.ts factory release-targeting-status [--registry-path factory-registry.json] [--policy-path <path> | --policy-json '{...}'] [--manifest-path <path>] [--manifest-ref <ref>] [--manifest-fetch-cmd '<cmd>'] [--local-release-cmd-by-factory '{"mothership":"hatch --version"}'] [--json]
  node packages/factory-ops/src/cli.ts factory upgrade-posture inspect <instance-id> [--registry-path factory-registry.json] [--policy-path factories/mothership/policy-pack/v1/release-policy.json] [--json]
  node packages/factory-ops/src/cli.ts factory upgrade-posture cohort <all|instance:<id>|kind:<id>|repo:<owner/repo>> --channel stable|canary|pinned [--pin-version <x.y.z>] [--registry-path factory-registry.json] [--policy-path factories/mothership/policy-pack/v1/release-policy.json] [--audit-log-path .hatch/upgrade-posture/audit-log.jsonl] [--actor <id>] [--dry-run] [--json]  # fail-closed on missing policy targets or compatibility conflicts
  node packages/factory-ops/src/cli.ts factory publish-control-plane-manifest --manifest-path <path> [--repo-root .]
  node packages/factory-ops/src/cli.ts factory release-rollout-controller --repo <owner/repo> --candidate-manifest-path <path> [--repo-path .] [--releases-dir .hatch/releases] [--runs-dir .hatch/runs] [--canary-manifest-path .hatch/releases/canary/release-manifest.json] [--general-manifest-path .hatch/releases/stable/release-manifest.json] [--canary-max-factories 1] [--health-policy-json '{...}'] [--tracking-issue <n>] [--factory-id mothership/release_rollout_controller] [--run-id <id>] [--holder-id <id>] [--lease-seconds 600] [--lookback-hours 24]
  node packages/factory-ops/src/cli.ts factory lease-acquire --repo <owner/repo> --tracking-issue <n> --factory-id <id> --lease-name <name> --run-id <id> [--lease-seconds 600]
  node packages/factory-ops/src/cli.ts factory lease-release --repo <owner/repo> --tracking-issue <n> --factory-id <id> --lease-name <name> --run-id <id> [--reason <txt>]
  node packages/factory-ops/src/cli.ts factory resolve-tracking-issue --repo <owner/repo> [--tracking-issue <n>]
  node packages/factory-ops/src/cli.ts host install-runtime [--host-base-dir <path>] [--host-id <id>] [--repo-root .] [--runtime-public-key-path <path>] [--runtime-signature <base64>] [--runtime-signature-key-id <id>] [--runtime-release-manifest-path <path>] [--runtime-signed-payload-path <path>]  # signature + trust root required; fails with host_runtime_signature_missing/host_runtime_signature_invalid
  node packages/factory-ops/src/cli.ts host status [--host-base-dir <path>] [--repo-root .] [--runtime-public-key-path <path>] [--runtime-signature <base64>] [--runtime-signature-key-id <id>] [--runtime-signed-payload-path <path>]
  node packages/factory-ops/src/cli.ts host doctor [--host-base-dir <path>] [--repo-root .] [--required-env A,B,C] [--runtime-public-key-path <path>] [--runtime-signature <base64>] [--runtime-signature-key-id <id>] [--runtime-signed-payload-path <path>]
  node packages/factory-ops/src/cli.ts host remove-runtime [--host-base-dir <path>] [--repo-root .] [--force true|false]
  node packages/factory-ops/src/cli.ts host runtime-intake-certify --repo <owner/repo> --issue-number <n> [--instance-id brainstorm] [--target-repo example-org/example-notes] [--workspace-mode api_only] [--host-base-dir <path>] [--repo-root .] [--registry-path <path>] [--registry-cwd <path>] [--destinations-json '{...}' | --destinations-json-b64 <base64>]  # runs hatch-host --once for the target installation and verifies goal creation/backlink/source closure invariants
  node packages/factory-ops/src/cli.ts host runtime-release build --version <id>|[--release-tag <tag>] [--release-sha <sha>] [--channel stable|canary|pinned] [--supported-kinds <k1,k2>] [--supported-platforms <p1,p2>] --artifact-url <url> [--artifact-checksum-sha256 <sha256>] [--runtime-signature <base64>] [--runtime-signature-key-id <id>] [--runtime-signature-algorithm sha256] [--runs-dir .hatch/runs] [--releases-dir .hatch/releases] [--out-path <path>]
  node packages/factory-ops/src/cli.ts host runtime-release publish --repo <owner/repo> --version <id>|[--release-tag <tag>] [--release-sha <sha>] [--channel stable|canary|pinned] [--supported-kinds <k1,k2>] [--supported-platforms <p1,p2>] --artifact-url <url> [--artifact-checksum-sha256 <sha256>] [--runtime-signature <base64>] [--runtime-signature-key-id <id>] [--runtime-signature-algorithm sha256] [--runs-dir .hatch/runs] [--releases-dir .hatch/releases] [--out-path <path>]  # publishes manifest asset via control-plane-release-asset primitive
  node packages/factory-ops/src/cli.ts factory host-install --factory-id <id> [--host-base-dir <path>] [--logs-root <path>] [--runs-dir <path>] [--tmp-dir <path>] [--socket-dir <path>] [--pid-dir <path>]  # mode: managed-only
  node packages/factory-ops/src/cli.ts factory host-start --factory-id <id> [--host-base-dir <path>] [--daemon-script <path>] [--detach true|false]  # mode: managed-only
  node packages/factory-ops/src/cli.ts factory host-stop --factory-id <id> [--host-base-dir <path>] [--signal TERM] [--timeout-ms 5000]  # mode: managed-only
  node packages/factory-ops/src/cli.ts factory host-restart --factory-id <id> [--host-base-dir <path>] [--daemon-script <path>] [--signal TERM] [--timeout-ms 5000]  # mode: managed-only
  node packages/factory-ops/src/cli.ts factory host-health --factory-id <id> [--host-base-dir <path>]  # mode: managed-only
  node packages/factory-ops/src/cli.ts factory host-version --factory-id <id> [--host-base-dir <path>]  # mode: managed-only
  node packages/factory-ops/src/cli.ts factory host-logs --factory-id <id> [--host-base-dir <path>] [--tail 100] [--since-duration 1h]  # mode: managed-only
  node packages/factory-ops/src/cli.ts factory provision-repo --instance-id <id> [--dry-run] [--registry-path factory-registry.json] [--repo-root <path>] [--target-repo-path <path>] [--instance-path .hatch/instance.json]
  node packages/factory-ops/src/cli.ts factory provisioning-drift (--instance-id <id> | --all) [--registry-path factory-registry.json] [--repo-root <path>] [--target-repo-path <path>] [--target-repo-map-json <path>] [--labels-json-path <path>] [--instance-path .hatch/instance.json] [--json]
  node packages/factory-ops/src/cli.ts factory target-repo bootstrap --target-repo <abs/path/to/target-repo> [--instance-path .hatch/instance.json] [--dry-run]
  node packages/factory-ops/src/cli.ts factory target-repo validate --target-repo <abs/path/to/target-repo> [--instance-path .hatch/instance.json] [--issue-templates-dir factories/brainstorm/issue_templates] [--json] [--summary]
  node packages/factory-ops/src/cli.ts factory service-profile inspect <instance-id> [--registry-path factory-registry.json]  # prints service-profile JSON only
  node packages/factory-ops/src/cli.ts factory service-profile update <instance-id> --profile <json-file> [--registry-path factory-registry.json]  # validates against shared registry schema and fails closed on unknown/invalid service-profile fields
  node packages/factory-ops/src/cli.ts factory status [--factory-id <id>] [--runs-dir .hatch/runs] [--json]  # mode: both (standalone + managed)
  node packages/factory-ops/src/cli.ts factory triage-queues [--factory-id <id>] [--registry-path factory-registry.json] [--mirror-dir <path>] [--host-base-dir <path>] [--event-limit 200] [--json | --format human|json]
  node packages/factory-ops/src/cli.ts factory fleet-triage-queues [--factory-id <id>] [--runs-dir .hatch/runs] [--lookback-hours 24] [--json | --format human|json]
  node packages/factory-ops/src/cli.ts factory triage-blast-radius --fingerprint <id> [--factory-id <id>] [--registry-path factory-registry.json] [--mirror-dir <path>] [--host-base-dir <path>] [--event-limit 200] [--json | --format human|json]  # invalid/missing fingerprint exits non-zero with structured error payload
  node packages/factory-ops/src/cli.ts doctor canonical-checkout
  node packages/factory-ops/src/cli.ts doctor repair-canonical-checkout
  node packages/factory-ops/src/cli.ts doctor relink-cli
  node packages/factory-ops/src/cli.ts factory control-state --factory-id <id>
  node packages/factory-ops/src/cli.ts factory pause --factory-id <id> --reason <txt>
  node packages/factory-ops/src/cli.ts factory quarantine --factory-id <id> --reason <txt>
  node packages/factory-ops/src/cli.ts factory retry --factory-id <id> --reason <txt> [--retry-target <run-or-issue>]
  node packages/factory-ops/src/cli.ts factory unblock --factory-id <id> --reason <txt>
  node packages/factory-ops/src/cli.ts factory resume --factory-id <id> --reason <txt>
  node packages/factory-ops/src/cli.ts factory tick-status [--factory-id <id>] [--runs-dir .hatch/runs] [--json]  # mode: both (standalone + managed)
  node packages/factory-ops/src/cli.ts factory dashboard [--factory-id <id>] [--runs-dir .hatch/runs] [--lookback-hours 24] [--json]  # summary includes AwaitingHardPlanReview from hard-goal post-plan human holds
  node packages/factory-ops/src/cli.ts factory dashboard-tui [--factory-id <id>] [--runs-dir .hatch/runs] [--lookback-hours 24] [--refresh-ms 2000]
  node packages/factory-ops/src/cli.ts factory session-browser [--factory-id <id>] [--runs-dir .hatch/runs] [--lookback-hours 24] [--refresh-ms 2000]
  node packages/factory-ops/src/cli.ts factory recovery-sweep [--factory-id <id>] --runs-dir <path> --stale-minutes <n> [--apply true] [--run-id <id>] [--worktree <path>] [--branch <name>]
  node packages/factory-ops/src/cli.ts factory active-summary [--runs-dir .hatch/runs] [--json] [--minimal] [--follow] [--interval-ms 2000]
  node packages/factory-ops/src/cli.ts factory recent-failures [--runs-dir .hatch/runs] [--limit 10]
  node packages/factory-ops/src/cli.ts factory outcomes [--repo recallnet/astrochicken] [--repo-path .] [--lookback-hours 24]
  node packages/factory-ops/src/cli.ts factory review-metrics [--factory-id <id>] [--runs-dir .hatch/runs] [--lookback-hours 24] [--window 0] [--json]
  node packages/factory-ops/src/cli.ts factory subscribe [--factory-id <id>] [--runs-dir .hatch/runs] [--event <types>] [--stream] [--timeout <seconds>] [--run-id <id>]  # mode: both (standalone + managed)
  node packages/factory-ops/src/cli.ts insight failures [--runs-dir .hatch/runs] [--lookback-hours 24] [--top 5] [--graph <graph>] [--node <node>] [--json]
  node packages/factory-ops/src/cli.ts insight retries [--runs-dir .hatch/runs] [--lookback-hours 24] [--top 5] [--graph <graph>] [--node <node>] [--json]
  node packages/factory-ops/src/cli.ts insight latency [--runs-dir .hatch/runs] [--lookback-hours 24] [--top 5] [--graph <graph>] [--node <node>] [--json]
  node packages/factory-ops/src/cli.ts release build-report-context --repo <owner/repo> [--repo-path .] [--factory-id <id>] [--lookback-hours 24] [--now <iso>]
  node packages/factory-ops/src/cli.ts release evaluate-worthiness (--context '{...}' | --context-b64 <base64>)
  node packages/factory-ops/src/cli.ts release build-slack-blocks (--context '{...}' | --context-b64 <base64>) (--narrative '{...}' | --narrative-b64 <base64>)
  node packages/factory-ops/src/cli.ts release normalize-comprehension [--context '{...}' | --context-b64 <base64>] [--narrative '{...}' | --narrative-b64 <base64>]  # fail-open; always returns {ok:true,normalized_narrative,warnings}
  node packages/factory-ops/src/cli.ts release publish-report (--context '{...}' | --context-b64 <base64>) (--narrative '{...}' | --narrative-b64 <base64>) [--repo <owner/repo>]
  node packages/factory-ops/src/cli.ts release emit-narrative-document (--context '{...}' | --context-b64 <base64>) (--narrative '{...}' | --narrative-b64 <base64>) --issue-url <url> [--repo-path .] [--factory-id <id>] [--output-dir reports/release/narratives] [--taxonomy-json '["delivery"]'] [--category delivery] [--tags-json '["release-report"]'] [--topics-json '["repo","factory"]'] [--publishable true|false] [--contains-internal-only true|false] [--internal-only-sections-json '[...]']
  node packages/factory-ops/src/cli.ts release post-to-slack (--context '{...}' | --context-b64 <base64>) (--payload '{...}' | --payload-b64 <base64>) [--webhook-url <url>] [--factory-root <path>] [--config-path <path>] [--max-attempts 3] [--retry-delay-ms 250]  # webhook resolution precedence: --webhook-url > FACTORY_SLACK_WEBHOOK_URL > factory.config.json slack_webhook_url
  node packages/factory-ops/src/cli.ts release example-web-followup (--context '{...}' | --context-b64 <base64>) (--narrative '{...}' | --narrative-b64 <base64>) [--factory-id <id>] [--repo-path .]
  node packages/factory-ops/src/cli.ts release check-new-content (--context '{...}' | --context-b64 <base64>)
  node packages/factory-ops/src/cli.ts release narrator-guardrails
  node packages/factory-ops/src/cli.ts release comprehension-catchup [--repo <owner/repo>] [--lookback-days 14] [--limit 5] [--out-dir reports/comprehension]
  node packages/factory-ops/src/cli.ts release validate-policy (--policy-path <path> | --policy-json '{...}')
  node packages/factory-ops/src/cli.ts release rollout-events [--manifest-path <path>] [--manifest-fetch-cmd '<cmd>'] [--manifest-ref <ref>] [--control-plane-repo <owner/repo>] [--rollout-channel stable|canary|pinned] [--json]
  node packages/factory-ops/src/cli.ts factory agent-trace [--runs-dir .hatch/runs] [--run-id <id>] [--max-items 3]
  node packages/factory-ops/src/cli.ts factory audit-records [--instance-id <id>] [--since <iso8601>] [--to <iso8601>] [--action issue_create|issue_close|issue_label|comment_create] [--host-id <id>] [--host-base-dir <path>] [--log-path <path>] [--json]  # reads append-only audit.v1 records from ~/.hatch-hosts/<host-id>/audit/audit.v1.log
  node packages/factory-ops/src/cli.ts factory session [--runs-dir .hatch/runs] [--run-id <id>] --node <node-id> [--lines 20] [--follow] [--poll-ms 1000]
  node packages/factory-ops/src/cli.ts brainstorm next-issue --repo <owner/repo> [--label brainstorm] [--factory-id <id>] [--root-dir .]
  node packages/factory-ops/src/cli.ts brainstorm load-context --factory-id <id> [--root-dir .] --brainstorm-issue-number <n> [--brainstorm-issue-body <txt> | --brainstorm-issue-body-b64 <base64>] [--intent-stack <json> | --intent-stack-b64 <base64>] [--shipped-goals-since-last <json> | --shipped-goals-since-last-b64 <base64>] [--scenario-holdouts <json> | --scenario-holdouts-b64 <base64>] [--open-backlog-summary <txt> | --open-backlog-summary-b64 <base64>]
  node packages/factory-ops/src/cli.ts brainstorm intake-context --repo <owner/repo> --factory-id <id> [--root-dir .] --intake-json '<json>'
  node packages/factory-ops/src/cli.ts brainstorm bump-round --round <n> [--max-rounds 10]
  node packages/factory-ops/src/cli.ts brainstorm check-output (--agent-output <txt> | --agent-output-b64 <base64>) [--source red|blue|force_wrap|format_repair]
  node packages/factory-ops/src/cli.ts brainstorm post-turn-comment --repo <owner/repo> --issue-number <n> --source <red|blue|force_wrap|format_repair> --round <n> (--agent-output <txt> | --agent-output-b64 <base64>) [--is-final false] [--run-id <id>] [--langfuse-project-url <url>]
  node packages/factory-ops/src/cli.ts brainstorm create-goal --repo <owner/repo> --brainstorm-issue-number <n> [--destinations-json '{...}' | --destinations-json-b64 <base64>] [--seed-prompt <txt> | --seed-prompt-b64 <base64>] [--final-round <n>] [--final-report <txt> | --final-report-b64 <base64>]
  node packages/factory-ops/src/cli.ts brainstorm close-issue --repo <owner/repo> --brainstorm-issue-number <n> [--factory-id <id>] [--root-dir .] [--next-cursor '<json>' | --next-cursor-b64 <base64>]
  node packages/factory-ops/src/cli.ts analysis daily-report --date <YYYY-MM-DD> --repo <owner/repo> [--output-dir reports/daily] [--langfuse-retries 2] [--log-level info]
  node packages/factory-ops/src/cli.ts labels normalize --repo <owner/repo> [--factory-id <id>] ([--state open|all] [--allowed a,b,c] [--dry-run true|false] | [--issue-labels '<csv>' | --issue-labels-b64 <base64>])
  node packages/factory-ops/src/cli.ts labels ensure --repo <owner/repo> --factory-id <id> --keys ready,goal
  node packages/factory-ops/src/cli.ts labels contract [--factory-id <id>]
  node packages/factory-ops/src/cli.ts labels validate-contract [--factory-id <id>]
  node packages/factory-ops/src/cli.ts labels validate-repo --repo <owner/repo> [--factory-id <id>]
  node packages/factory-ops/src/cli.ts scenario ensure-structure --payload '{...}'
  node packages/factory-ops/src/cli.ts scenario validate-scope --payload '{...}'
  node packages/factory-ops/src/cli.ts scenario validate-payload --payload '{...}'
  node packages/factory-ops/src/cli.ts scenario save --payload '{...}' [--registry-root <path>]
  node packages/factory-ops/src/cli.ts scenario count-gate [--registry-root factories/mothership/scenarios] [--max-count 30]
  node packages/factory-ops/src/cli.ts scenario add [--registry-root factories/mothership/scenarios/astrochicken] --id <kebab-id> --domain <kebab-domain> --priority <critical|high|medium|low> --truth '<1-5 lines>' [--created YYYY-MM-DD]  # deliberate/manual action; add only when evidence shows a missing durable invariant
  node packages/factory-ops/src/cli.ts scenario curate [--registry-root factories/mothership/scenarios/astrochicken] [--runs-root .hatch/runs] [--lookback-runs 30] [--stale-days 90] [--output-json]  # curation review surface with usage/staleness and fail-closed registry ceiling
  node packages/factory-ops/src/cli.ts governance sanitize-overlap --repo <owner/repo> [--dry-run true|false] [--run-id <id>] [--pipeline <name>]
  node packages/factory-ops/src/cli.ts graph migrate-trust-participants [--graphs-dir factories/mothership/graphs] [--paths a.dot,b.dot] [--write true|false] [--active true|false]
  node packages/factory-ops/src/cli.ts graph check-trust-participants [--graphs-dir factories/mothership/graphs] [--paths a.dot,b.dot] [--strict true|false] [--active true|false]
  node packages/factory-ops/src/cli.ts supervisor status --repo <owner/repo>
  node packages/factory-ops/src/cli.ts supervisor state-snapshot --repo <owner/repo> [--factory-id <id>] [--target-repo <owner/repo>] [--control-plane-repo <owner/repo>] [--runs-dir <path>]  # defaults to .hatch/<factory-id>/runs when --factory-id is set
  node packages/factory-ops/src/cli.ts supervisor health-check --repo <owner/repo> [--factory-id <id>] [--runs-dir <path>] [--run-id <id>] [--pipeline <name>]
  node packages/factory-ops/src/cli.ts supervisor validate-main-branch --repo <owner/repo> [--run-id <id>] [--pipeline <name>]
  node packages/factory-ops/src/cli.ts supervisor remediate-orphan-features --repo <owner/repo> [--run-id <id>] [--pipeline <name>] [--dry-run true|false]
  node packages/factory-ops/src/cli.ts supervisor sanitize-goals --repo <owner/repo> [--run-id <id>] [--pipeline <name>] [--dry-run true|false]
  node packages/factory-ops/src/cli.ts supervisor detect-stalled-wave --repo <owner/repo> [--run-id <id>] [--pipeline <name>] [--stale-minutes 20] [--runs-dir .hatch/runs] [--apply-remediation true|false] [--remediation-dry-run true|false] [--history-limit 50] [--repeat-threshold 3] [--repeat-window-minutes 60]
  node packages/factory-ops/src/cli.ts supervisor diagnose-stalled-waves --repo <owner/repo> [--stale-minutes 20] [--runs-dir <path>]
  node packages/factory-ops/src/cli.ts supervisor external-factory-lifecycle --control-plane-repo <owner/repo> --source-repo <owner/repo> [--source-issue-number <n>] [--blocked-items '[...]'] [--milestone-title <title>] [--factory-id <id>]
  node packages/factory-ops/src/cli.ts supervisor managed-domain-contract --dot-path <path-to-domain.dot>
  node packages/factory-ops/src/cli.ts supervisor normalize-feature-labels --repo <owner/repo> [--dry-run true|false]
  node packages/factory-ops/src/cli.ts supervisor detect-orphan-features --repo <owner/repo> [--run-id <id>] [--pipeline <name>]
  node packages/factory-ops/src/cli.ts supervisor audit-blocked-labels --repo <owner/repo>`;
