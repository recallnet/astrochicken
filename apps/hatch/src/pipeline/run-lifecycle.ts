import { appendFileSync } from "node:fs";

import {
  buildHatchRunLifecycleCloudEvent,
  validateHatchRunLifecycleEvent,
  validateHatchRunLifecycleCloudEvent,
  type HatchRunLifecycleEvent as RunLifecycleEvent,
} from "@hatch/factory-core/hatch-run-lifecycle-asyncapi";
import { buildHatchRunLifecycleLineageProjection } from "@hatch/factory-core/openlineage-registry";

export type { RunLifecycleEvent };

export interface LifecycleEventState {
  runId: string;
  pipelineFile: string;
  pipeline?: string;
  status: string;
  currentNode: string;
  context: Record<string, string>;
}

export interface AppendRunLifecycleEventsOptions {
  previous?: LifecycleEventState | null;
  current: LifecycleEventState;
  nowIso: string;
  path: string;
  onEvents?: (events: RunLifecycleEvent[]) => void;
}

function lifecycleArtifactUrls(context: Record<string, string> = {}): Set<string> {
  const urls = new Set<string>();
  for (const [key, value] of Object.entries(context || {})) {
    if (key.includes("artifact_url") && typeof value === "string" && value.startsWith("http")) {
      urls.add(value);
    }
  }
  return urls;
}

function lifecycleGraph(state: LifecycleEventState): string {
  const explicit = String(state.pipelineFile || state.pipeline || "").trim();
  if (!explicit) return "";
  const file = explicit.split(/[\\/]/).pop() || explicit;
  return file.replace(/\.dot$/i, "");
}

function lifecycleIssue(state: LifecycleEventState): string {
  return String(
    state.context?.issue_number
    || state.context?.current_issue_number
    || state.context?.source_issue
    || "",
  ).trim();
}

function lifecycleMilestone(state: LifecycleEventState): string {
  return String(
    state.context?.milestone_title
    || state.context?.wave_milestone
    || state.context?.milestone
    || "",
  ).trim();
}

function lifecycleTraceparent(state: LifecycleEventState): string {
  return String(
    state.context?.traceparent
    || state.context?.__traceparent
    || "",
  ).trim();
}

function lifecycleTracestate(state: LifecycleEventState): string {
  return String(
    state.context?.tracestate
    || state.context?.__tracestate
    || "",
  ).trim();
}

function buildLifecycleEvents(previous: LifecycleEventState | null, current: LifecycleEventState, nowIso: string): RunLifecycleEvent[] {
  const graph = lifecycleGraph(current);
  const issue = lifecycleIssue(current);
  const milestone = lifecycleMilestone(current);
  const currentNode = String(current.currentNode || "").trim();
  const events: RunLifecycleEvent[] = [];

  if (!previous) {
    events.push({ schemaVersion: 1, ts: nowIso, event: "run-start", runId: current.runId, graph, node: currentNode, issue, milestone });
  }

  const previousNode = String(previous?.currentNode || "").trim();
  if (previousNode !== currentNode && currentNode) {
    events.push({ schemaVersion: 1, ts: nowIso, event: "node-change", runId: current.runId, graph, node: currentNode, prevNode: previousNode, issue, milestone });
  }

  const previousStatus = String(previous?.status || "").trim();
  const currentStatus = String(current.status || "").trim();
  if (previousStatus !== currentStatus) {
    if (currentStatus === "completed") {
      events.push({ schemaVersion: 1, ts: nowIso, event: "complete", runId: current.runId, graph, node: currentNode, issue, milestone });
      if (graph === "merge_item" || graph.includes("merge")) {
        events.push({ schemaVersion: 1, ts: nowIso, event: "merge", runId: current.runId, graph, node: currentNode, issue, milestone, mergeStatus: "completed" });
      }
    } else if (["failed", "guarded", "guarded_terminal", "blocked", "terminal"].includes(currentStatus)) {
      events.push({ schemaVersion: 1, ts: nowIso, event: "fail", runId: current.runId, graph, node: currentNode, issue, milestone });
    }
  }

  const previousArtifacts = lifecycleArtifactUrls(previous?.context || {});
  for (const url of lifecycleArtifactUrls(current.context || {})) {
    if (previousArtifacts.has(url)) continue;
    events.push({ schemaVersion: 1, ts: nowIso, event: "artifact", runId: current.runId, graph, node: currentNode, issue, milestone, artifactUrl: url });
  }

  return events;
}

export function appendRunLifecycleEvents({ previous = null, current, nowIso, path, onEvents }: AppendRunLifecycleEventsOptions): void {
  const events = buildLifecycleEvents(previous || null, current, nowIso).map((event) => {
    const validated = validateHatchRunLifecycleEvent(event);
    if (!validated.ok || !validated.value) {
      throw new Error(`invalid_hatch_run_lifecycle_event:${validated.errors.map((entry) => `${entry.path}:${entry.message}`).join(",")}`);
    }
    return validated.value;
  });
  if (events.length === 0) return;
  const cloudEvents = events.map((entry) => {
    const cloudEvent = buildHatchRunLifecycleCloudEvent({
      id: `${entry.runId}:${entry.event}:${entry.ts}`,
      subject: entry.runId,
      time: entry.ts,
      traceparent: lifecycleTraceparent(current),
      tracestate: lifecycleTracestate(current),
      openlineage: buildHatchRunLifecycleLineageProjection(entry),
      data: entry,
    });
    const validated = validateHatchRunLifecycleCloudEvent(cloudEvent);
    if (!validated.ok || !validated.value) {
      throw new Error(`invalid_hatch_run_lifecycle_cloudevent:${validated.errors.map((issue) => `${issue.path}:${issue.message}`).join(",")}`);
    }
    return validated.value;
  });
  appendFileSync(path, cloudEvents.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  if (onEvents) {
    onEvents(events);
  }
}
