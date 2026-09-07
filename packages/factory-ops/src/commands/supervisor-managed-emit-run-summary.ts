import { emitGovernedOtelEvent } from "@recallnet/factory-telemetry";

import { buildManagedRunSummary } from "./supervisor-managed-summary.ts";
import {
  assertPayloadWithinBoundary,
  sanitizeMirroredPayload,
} from "../lib/managed-observability-boundary.ts";

export function emitManagedRunSummary(args = {}) {
  const summary = buildManagedRunSummary(args);
  const { sanitizedPayload: mirroredSummary, droppedKeys } = sanitizeMirroredPayload(summary);
  assertPayloadWithinBoundary(mirroredSummary);

  if (droppedKeys.length > 0) {
    process.stderr.write(`[managed-observability-boundary] stripped_keys=${droppedKeys.join(",") || "none"}\n`);
  }

  emitGovernedOtelEvent({
    event_name: "factory.managed_supervisor.run_summary",
    severity_text: mirroredSummary.failure?.classification && mirroredSummary.failure.classification !== "none" ? "WARN" : "INFO",
    correlation: {
      factory_id: mirroredSummary.factory_id || "managed-factory",
      run_id: mirroredSummary.run_id || mirroredSummary.tick_id || "managed-supervisor",
      workflow_id: "managed_supervisor",
      capability_id: "supervisor",
      owner: "factory_ops.supervisor_managed_emit_run_summary",
    },
    attributes: {
      instance_id: mirroredSummary.instance_id,
      kind_id: mirroredSummary.kind_id,
      target_repo: mirroredSummary.context?.target_repo || "",
      control_plane_repo: mirroredSummary.context?.control_plane_repo || "",
      lifecycle_state: mirroredSummary.lifecycle?.state || "",
      health_state: mirroredSummary.lifecycle?.health_state || "",
      failure_classification: mirroredSummary.failure?.classification || "none",
      control_gate: mirroredSummary.lifecycle?.control_gate || "",
    },
    body: mirroredSummary,
  });
  return mirroredSummary;
}
