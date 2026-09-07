export const IRREVERSIBLE_NODE_COVERAGE_MANIFEST = Object.freeze([
  {
    graph: "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs",
    node: "publish_release_report",
    command_module: "packages/factory-ops/src/commands/release-publish-report.ts",
    prompt_pattern: "action_id=\"release.publish_report\"",
    contract_tests: [
      "packages/factory-ops/test/commands/release-publish-report.contract.test.ts",
      "packages/factory-ops/test/commands/prompt-golden-snapshot.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/release-publish-report.unit.test.ts",
    ],
  },
  {
    graph: "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs",
    node: "create_shaping_followup_issue",
    command_module: "packages/factory-ops/src/commands/release-example-web-followup.ts",
    prompt_pattern: "action_id=\"release.shaping_followup\"",
    contract_tests: [
      "packages/factory-ops/test/commands/prompt-golden-snapshot.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/release-example-web-followup.unit.test.ts",
    ],
  },
  {
    graph: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    node: "recovery_sweep_runtime",
    command_module: "packages/factory-ops/src/commands/factory-recovery-sweep.ts",
    prompt_pattern: "action_id=\"factory.recovery_sweep\"",
    contract_tests: [
      "packages/factory-ops/test/supervisor/factory-recovery-sweep.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/supervisor/factory-recovery-sweep.test.ts",
    ],
  },
  {
    graph: "factories/mothership/graphs/factory_dispatch_reactor.dot",
    node: "sweep_completed_goals",
    command_module: "packages/factory-ops/src/commands/goal-sweep-completed.ts",
    prompt_pattern: "action_id=\"goal.sweep_completed\"",
    contract_tests: [
      "packages/factory-ops/test/supervisor/supervisor-tick.contract.test.ts",
      "packages/factory-ops/test/supervisor/reactor-dispatch.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/goal-sweep-completed.test.ts",
    ],
  },
  {
    graph: "factories/mothership/graphs/factory_dispatch_reactor.dot",
    node: "release_quarantine",
    command_module: "packages/factory-ops/src/commands/wave-handle-review-failures.ts",
    prompt_pattern: "action_id=\"wave.release_quarantine\"",
    contract_tests: [
      "packages/factory-ops/test/supervisor/supervisor-tick.contract.test.ts",
      "packages/factory-ops/test/supervisor/reactor-dispatch.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/wave-handle-review-failures.unit.test.ts",
    ],
  },
  {
    graph: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    node: "apply_rejected_upstream",
    command_module: "packages/factory-ops/src/commands/triage-apply-status.ts",
    prompt_pattern: "action_id=\"triage.apply_rejected_upstream\"",
    contract_tests: [
      "packages/factory-ops/test/supervisor/supervisor-tick.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/triage-apply-status.test.ts",
    ],
  },
  {
    graph: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    node: "emit_disposition_feedback",
    command_module: "packages/factory-ops/src/commands/artifact-feedback.ts",
    prompt_pattern: "action_id=\"artifact.emit_disposition_feedback\"",
    contract_tests: [
      "packages/factory-ops/test/supervisor/supervisor-tick.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/artifact-feedback.test.ts",
    ],
  },
  {
    graph: "factories/mothership/workflows/goal-execution/goal_issue_execute.workflow-source.mjs",
    node: "assert_main_after_build",
    command_module: "packages/factory-ops/src/commands/merge-item-ops.ts",
    prompt_pattern: "action_id=\"merge.assert_main_branch\"",
    contract_tests: [
      "packages/factory-ops/test/supervisor/supervisor-tick.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/merge/merge-assert-main.unit.test.ts",
    ],
  },
  {
    graph: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
    node: "mark_decompose_attempt",
    command_module: "packages/factory-ops/src/commands/goal-run-state.ts",
    prompt_pattern: "action_id=\"goal.post_decompose_attempt\"",
    contract_tests: [
      "packages/factory-ops/test/commands/goal-run-retry.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/goal-decompose-attempt-marker.unit.test.ts",
    ],
  },
  {
    graph: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
    node: "exhaust_decompose_retries",
    command_module: "packages/factory-ops/src/commands/goal-run-state.ts",
    prompt_pattern: "action_id=\"goal.exhaust_decompose_retries\"",
    contract_tests: [
      "packages/factory-ops/test/commands/goal-run-retry.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/goal-run-state.test.ts",
    ],
  },
  {
    graph: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
    node: "mark_dispatched",
    command_module: "packages/factory-ops/src/commands/goal-run-state.ts",
    prompt_pattern: "action_id=\"goal.mark_dispatched\"",
    contract_tests: [
      "packages/factory-ops/test/commands/goal-run-retry.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/goal-run-state.test.ts",
    ],
  },
  {
    graph: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
    node: "persist_decomposition_packet",
    command_module: "packages/factory-ops/src/commands/goal-decomposition-packet.ts",
    prompt_pattern: "action_id=\"goal.persist_decomposition_packet\"",
    contract_tests: [
      "packages/factory-ops/test/commands/decompose.contract.test.ts",
      "packages/factory-ops/test/commands/goal-run-retry.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/packets/goal-decomposition-packet.unit.test.ts",
      "packages/factory-ops/test/commands/goal-check-decomposed.unit.test.ts",
    ],
  },
  {
    graph: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
    node: "materialize_hard_plan",
    command_module: "packages/factory-ops/src/commands/goal-hard-plan-materialize.ts",
    prompt_pattern: "action_id=\"goal.materialize_approved_plan\"",
    contract_tests: [
      "packages/factory-ops/test/commands/decompose.contract.test.ts",
      "packages/factory-ops/test/commands/goal-run-retry.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/goal-hard-plan-materialize.unit.test.ts",
      "packages/factory-ops/test/commands/goal-hard-plan-materialize.cli.test.ts",
    ],
  },
  {
    graph: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
    node: "keep_open",
    command_module: "packages/factory-ops/src/commands/goal-run-state.ts",
    prompt_pattern: "action_id=\"goal.post_retry_comment\"",
    contract_tests: [
      "packages/factory-ops/test/commands/goal-run-retry.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/goal-run-state.test.ts",
    ],
  },
  {
    graph: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
    node: "keep_open_direct",
    command_module: "packages/factory-ops/src/commands/goal-run-state.ts",
    prompt_pattern: "action_id=\"goal.post_retry_comment\"",
    contract_tests: [
      "packages/factory-ops/test/commands/goal-run-retry.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/goal-run-state.test.ts",
    ],
  },
  {
    graph: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
    node: "duplicate_decompose_guard",
    command_module: "packages/factory-ops/src/commands/goal-duplicate-decompose-guard.ts",
    prompt_pattern: "action_id=\"goal.guard_duplicate_decompose\"",
    contract_tests: [
      "packages/factory-ops/test/commands/goal-run-retry.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/goal-duplicate-decompose-guard.unit.test.ts",
    ],
  },
  {
    graph: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
    node: "resolve_deps",
    command_module: "packages/factory-ops/src/commands/triage-resolve-feature-dependencies.ts",
    prompt_pattern: "action_id=\"triage.resolve_feature_dependencies\"",
    contract_tests: [
      "packages/factory-ops/test/commands/goal-run-retry.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/triage-resolve-feature-dependencies.unit.test.ts",
    ],
  },
  {
    graph: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
    node: "label_issues",
    command_module: "packages/factory-ops/src/commands/goal-label-created-issues.ts",
    prompt_pattern: "action_id=\"goal.label_created_issues\"",
    contract_tests: [
      "packages/factory-ops/test/commands/goal-run-retry.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/goal-label-created-issues.unit.test.ts",
    ],
  },
  {
    graph: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
    node: "apply_feature_blockers",
    command_module: "packages/factory-ops/src/commands/goal-apply-feature-blockers.ts",
    prompt_pattern: "action_id=\"goal.apply_feature_blockers\"",
    contract_tests: [
      "packages/factory-ops/test/commands/goal-run-retry.contract.test.ts",
    ],
    executable_tests: [
      "packages/factory-ops/test/commands/goal-apply-feature-blockers.unit.test.ts",
    ],
  },

]);
