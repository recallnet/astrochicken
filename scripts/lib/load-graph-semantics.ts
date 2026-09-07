import { existsSync, readFileSync } from "node:fs";

import {
  renderWorkflowSourceModuleToDot,
} from "../../packages/factory-core/src/workflow-ir-registry.ts";
import {
  exportWorkflowSourceDocument,
} from "../../packages/factory-core/src/workflow-source-registry.ts";

function trim(value = "") {
  return String(value || "").trim();
}

export function isWorkflowSourceModulePath(filePath = "") {
  return trim(filePath).endsWith(".workflow-source.mjs");
}

export function loadGraphSemanticsText(filePath = "") {
  const normalizedPath = trim(filePath);
  if (!normalizedPath) return "";
  if (!isWorkflowSourceModulePath(normalizedPath)) {
    return readFileSync(normalizedPath, "utf8");
  }
  const workflowSourceDataPath = normalizedPath.replace(/\.workflow-source\.mjs$/u, ".workflow-source.data.json");
  if (!existsSync(workflowSourceDataPath)) {
    throw new Error(`workflow_source_data_missing:${workflowSourceDataPath}`);
  }
  const workflowSourceData = JSON.parse(readFileSync(workflowSourceDataPath, "utf8"));
  return renderWorkflowSourceModuleToDot(exportWorkflowSourceDocument(workflowSourceData), {
    hostPath: normalizedPath,
  });
}
