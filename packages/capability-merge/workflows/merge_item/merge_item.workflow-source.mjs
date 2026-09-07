import workflowSourceData from "./merge_item.workflow-source.data.json" with { type: "json" };
import { defineWorkflowSourceModule } from "../../../factory-core/src/workflow-source-registry.ts";

export const WORKFLOW_SOURCE_MODULE = defineWorkflowSourceModule(workflowSourceData);
export default WORKFLOW_SOURCE_MODULE;
