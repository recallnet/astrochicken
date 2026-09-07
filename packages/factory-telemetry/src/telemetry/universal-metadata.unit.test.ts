import { describe, expect, it } from "vitest";

import {
  buildUniversalEventData,
  collectFactoryTelemetryMetadata,
  deriveAbstractionLevel,
  deriveEventOutcome,
  deriveTelemetryPhase,
  deriveSessionId,
  factoryMetadataProviderFromIdentity,
  resolveModelProvider,
} from "./universal-metadata.js";

describe("universal telemetry metadata", () => {
  it("collects allowed factory metadata and merges provider identity", () => {
    const metadata = collectFactoryTelemetryMetadata({
      factory_context: JSON.stringify({ issue_number: 1551, branch: "wave/goal-1" }),
      factory_id: "mothership",
      factory_extra: "extra",
    }, factoryMetadataProviderFromIdentity({
      factory: "mothership",
      factory_id: "mothership",
      repo: "recallnet/astrochicken",
    }));

    expect(metadata).toMatchObject({
      issue_number: "1551",
      branch: "wave/goal-1",
      factory_id: "mothership",
      factory: "mothership",
      repo: "recallnet/astrochicken",
      factory_extra: "extra",
    });
  });

  it("builds universal event data and derives stable outcome/session/provider fields", () => {
    expect(resolveModelProvider("", "openai/gpt-5.3-codex")).toBe("openai");
    expect(deriveEventOutcome("guard.decision", { allowed: "false" }, false)).toBe("fail");
    expect(deriveSessionId({
      runId: "run-1",
      handlerType: "tool",
      nodeId: "build",
      attempt: "2",
      sequence: 1,
    })).toBe("run:run-1:handler:tool:node:build:attempt:2");
    expect(deriveAbstractionLevel({
      graphId: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
      graphName: "wave_execute",
      nodeId: "build",
      handlerType: "agent.worktree",
    })).toBe("wave");
    expect(deriveTelemetryPhase({
      graphId: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
      nodeId: "build",
      handlerType: "agent.worktree",
    })).toBe("implement");
    expect(deriveTelemetryPhase({
      graphId: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
      nodeId: "snapshot_state_fast",
      handlerType: "tool",
    })).toBe("snapshot");
    expect(deriveTelemetryPhase({
      graphId: "factories/mothership/graphs/goal_run.dot",
      nodeId: "triage",
      handlerType: "agent.worktree",
    })).toBe("triage");

    const event = buildUniversalEventData({
      runId: "run-1",
      graphName: "wave_execute",
      graphId: "graphs/wave_execute.dot",
      nodeId: "build",
      handlerType: "agent.worktree",
      skill: "coder",
      skillId: "coder.v1",
      skillVersion: "1",
      jobId: "job-1",
      promptVersion: "p1",
      roleVersion: "r1",
      model: "openai/gpt-5.3-codex",
      provider: "",
      promptHash: "sha256:abc",
      attempt: "2",
      outcome: "pass",
      sessionId: "sess-1",
      langfuseTraceId: "trace-1",
      abstractionLevel: "wave",
      phase: "implement",
      phaseNodeId: "build",
      parentRunId: "run-parent-1",
      parentGraphId: "factory_supervisor_tick.dot",
      parentTraceId: "lf_trace_parent_1",
      rootRunId: "run-root-1",
      rootGraphId: "factory_supervisor_tick.dot",
      lineageDepth: "2",
      factoryMetadata: {
        factory: "mothership",
        factory_id: "mothership",
        repo: "recallnet/astrochicken",
        issue_number: "1551",
      },
    });

    expect(event).toMatchObject({
      run_id: "run-1",
      graph: "wave_execute",
      model_provider: "openai",
      factory: "mothership",
      factory_id: "mothership",
      repo: "recallnet/astrochicken",
      abstraction_level: "wave",
      phase: "implement",
      phase_node_id: "build",
      parent_run_id: "run-parent-1",
      parent_graph_id: "factory_supervisor_tick.dot",
      parent_trace_id: "lf_trace_parent_1",
      root_run_id: "run-root-1",
      root_graph_id: "factory_supervisor_tick.dot",
      lineage_depth: "2",
      "factory.issue_number": "1551",
      "hatch.factory_meta.issue_number": "1551",
      "hatch.tag.outcome": "pass",
    });
  });
});
