export const ACTIVE_INTENTS_GRAPH_BASENAMES = Object.freeze([
  "factory_supervisor_tick.workflow-source.mjs",
  "goal_execute.workflow-source.mjs",
  "goal_issue_execute.workflow-source.mjs",
]);

export const ACTIVE_INTENTS_GRAPH_PATHS = Object.freeze([
  "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
  "factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs",
  "factories/mothership/workflows/goal-execution/goal_issue_execute.workflow-source.mjs",
  "packages/capability-goal-decomposition/workflows/goal_queue/goal_queue.workflow-source.mjs",
  "packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs",
  "packages/capability-goal-decomposition/workflows/goal_batch/goal_batch.workflow-source.mjs",
  "packages/capability-goal-decomposition/workflows/goal_factory/goal_factory.workflow-source.mjs",
  "packages/capability-goal-decomposition/workflows/goal_intake_decompose/goal_intake_decompose.workflow-source.mjs",
  "packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs",
  "packages/capability-goal-decomposition/workflows/write_issues/write_issues.workflow-source.mjs",
  "packages/capability-merge/workflows/merge_item/merge_item.workflow-source.mjs",
  "packages/capability-artifact-ingestion/workflows/artifact_ingest/artifact_ingest.workflow-source.mjs",
]);

export function listActiveIntentGraphPaths({ graphsDir = "factories/mothership/workflows" } = {}) {
  if (graphsDir === "factories/mothership/workflows") {
    return [...ACTIVE_INTENTS_GRAPH_PATHS];
  }
  return ACTIVE_INTENTS_GRAPH_BASENAMES.map((name) => `${graphsDir}/${name}`);
}
