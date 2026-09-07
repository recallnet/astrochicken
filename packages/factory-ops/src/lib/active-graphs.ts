export const ACTIVE_INTENTS_GRAPH_BASENAMES = Object.freeze([
  "factory_supervisor_tick.workflow-source.mjs",
  "goal_execute.workflow-source.mjs",
  "goal_issue_execute.workflow-source.mjs",
]);

export const ACTIVE_INTENTS_GRAPH_PATHS = Object.freeze([
  ...ACTIVE_INTENTS_GRAPH_BASENAMES.map((name) => `factories/mothership/workflows/software-delivery/${name}`),
  "packages/capability-goal-decomposition/workflows/goal_queue/goal_queue.workflow-source.mjs",
  "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
  "packages/capability-goal-decomposition/workflows/goal_batch/goal_batch.workflow-source.mjs",
  "packages/capability-goal-decomposition/workflows/goal_factory/goal_factory.workflow-source.mjs",
  "packages/capability-goal-decomposition/workflows/goal_intake_decompose/goal_intake_decompose.workflow-source.mjs",
  "packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs",
  "packages/capability-goal-decomposition/workflows/write_issues/write_issues.workflow-source.mjs",
  "packages/capability-merge/workflows/merge_item/merge_item.workflow-source.mjs",
  "packages/capability-artifact-ingestion/workflows/artifact_ingest/artifact_ingest.workflow-source.mjs",
]);

export function listActiveIntentGraphPaths({ graphsDir = "factories/mothership/workflows/software-delivery" } = {}) {
  if (graphsDir === "factories/mothership/workflows/software-delivery") {
    return [...ACTIVE_INTENTS_GRAPH_PATHS];
  }
  return ACTIVE_INTENTS_GRAPH_BASENAMES.map((name) => `${graphsDir}/${name}`);
}
