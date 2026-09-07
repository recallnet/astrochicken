import workflowSourceData from "./milestone_execute_parallel_item.workflow-source.data.json" with { type: "json" };
import { defineWorkflowSourceModule } from "../../../../packages/factory-core/src/workflow-source-registry.ts";

export const WORKFLOW_SOURCE_MODULE = defineWorkflowSourceModule(workflowSourceData);
