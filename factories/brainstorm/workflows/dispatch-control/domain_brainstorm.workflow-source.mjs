import workflowSourceData from "./domain_brainstorm.workflow-source.data.json" with { type: "json" };
import { defineWorkflowSourceModule } from "../../../../packages/factory-core/src/workflow-source-registry.ts";

export const WORKFLOW_SOURCE_MODULE = defineWorkflowSourceModule(workflowSourceData);
