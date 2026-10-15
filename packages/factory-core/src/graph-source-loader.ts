import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import {
  renderWorkflowSourceModuleToDot,
} from "./workflow-ir-registry.ts";
import {
  exportWorkflowSourceDocument,
} from "./workflow-source-registry.ts";

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
  // @context:regression Execute the trusted canonical module. Inline sources
  // and source validation must not be replaced by a guessed JSON sidecar.
  const namespace = createRequire(import.meta.url)(resolve(normalizedPath));
  const workflowSourceData = namespace.WORKFLOW_SOURCE_MODULE ?? namespace.default;
  return renderWorkflowSourceModuleToDot(exportWorkflowSourceDocument(workflowSourceData), {
    hostPath: normalizedPath,
  });
}
