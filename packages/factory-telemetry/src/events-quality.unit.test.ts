import { describe, expect, it } from "vitest";

import {
  EventBus,
  STAGE_FINISH_COMPLEXITY_CLASS_KEY,
  STAGE_FINISH_COMPLEXITY_OTEL_KEY,
  STAGE_FINISH_COMPLEXITY_REASON_KEY,
  STAGE_FINISH_COMPLEXITY_SIGNALS_KEY,
  STAGE_FINISH_EXECUTION_PATH_KEY,
  STAGE_FINISH_MERGE_RESOLVER_KEY,
  STAGE_FINISH_PATH_TAKEN_KEY,
} from "./events.js";
import { buildQualitySignalEventData, classifyFailureMessage } from "./quality.js";

describe("event and quality telemetry helpers", () => {
  it("exposes stable stage-finish metadata keys and emits events to subscribers", () => {
    expect(STAGE_FINISH_COMPLEXITY_CLASS_KEY).toBe("complexity_class");
    expect(STAGE_FINISH_COMPLEXITY_SIGNALS_KEY).toBe("complexity_signals");
    expect(STAGE_FINISH_COMPLEXITY_REASON_KEY).toBe("complexity_reason");
    expect(STAGE_FINISH_COMPLEXITY_OTEL_KEY).toBe("complexity_otel_key");
    expect(STAGE_FINISH_EXECUTION_PATH_KEY).toBe("hatch.execution.path");
    expect(STAGE_FINISH_PATH_TAKEN_KEY).toBe("path_taken");
    expect(STAGE_FINISH_MERGE_RESOLVER_KEY).toBe("hatch.merge.resolver");

    const bus = new EventBus();
    const received: string[] = [];
    const off = bus.on((event) => {
      received.push(event.kind);
    });
    bus.emit({ kind: "stage.finish" });
    off();
    bus.emit({ kind: "stage.error" });
    expect(received).toEqual(["stage.finish"]);
  });

  it("classifies failure messages and derives quality signal event data", () => {
    expect(classifyFailureMessage("Timed out waiting for agent")).toBe("timeout");
    expect(classifyFailureMessage("guard circuit open")).toBe("guard");
    expect(classifyFailureMessage("schema mismatch")).toBe("schema");
    expect(classifyFailureMessage("")).toBe("unknown");

    const signal = buildQualitySignalEventData({
      kind: "stage.error",
      traceId: "trace-1",
      nodeId: "build",
      message: "validation failed",
      data: {
        attempt: "2",
        guard_circuit_state: "open",
        handler_type: "agent.worktree",
        model: "openai/gpt-5.3-codex",
      },
      error: new Error("validation failed"),
    });

    expect(signal).toMatchObject({
      quality_outcome: "fail",
      quality_failure_class: "validation",
      "hatch.retry_class": "retry_fail",
      "hatch.first_attempt_pass": "false",
      "hatch.kpi.quality.skill": "agent.worktree",
    });
  });
});
