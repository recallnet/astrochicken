import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifySupervisorFailure,
  deriveIncidentSeverity,
} from "../../src/commands/supervisor-failure-classifier.ts";

describe("classifySupervisorFailure", () => {
  it("returns needs-triage with no arguments", () => {
    const result = classifySupervisorFailure();
    assert.equal(result.classification, "needs-triage");
    assert.equal(result.rationale, "insufficient_deterministic_signals");
    assert.equal(result.crash_type, "unknown");
  });

  it("classificationHint=platform yields platform via explicit_hint", () => {
    const result = classifySupervisorFailure({ classificationHint: "platform" });
    assert.equal(result.classification, "platform");
    assert.equal(result.rationale, "explicit_hint");
  });

  it("classificationHint=local yields local via explicit_hint", () => {
    const result = classifySupervisorFailure({ classificationHint: "local" });
    assert.equal(result.classification, "local");
    assert.equal(result.rationale, "explicit_hint");
  });

  it("evidence.classification=platform yields platform via explicit_hint", () => {
    const result = classifySupervisorFailure({
      evidence: { classification: "platform" },
    });
    assert.equal(result.classification, "platform");
    assert.equal(result.rationale, "explicit_hint");
  });

  it("evidence.ownership_hint=control_plane yields platform via ownership_hint", () => {
    const result = classifySupervisorFailure({
      evidence: { ownership_hint: "control_plane" },
    });
    assert.equal(result.classification, "platform");
    assert.equal(result.rationale, "ownership_hint");
  });

  it("evidence.ownership_hint=local_factory yields local via ownership_hint", () => {
    const result = classifySupervisorFailure({
      evidence: { ownership_hint: "local_factory" },
    });
    assert.equal(result.classification, "local");
    assert.equal(result.rationale, "ownership_hint");
  });

  it("evidence.file_path in packages/factory-ops yields platform via path_signal", () => {
    const result = classifySupervisorFailure({
      evidence: { file_path: "packages/factory-ops/src/foo.mjs" },
    });
    assert.equal(result.classification, "platform");
    assert.equal(result.rationale, "path_signal");
  });

  it("evidence.file_path in non-mothership factory yields local via path_signal", () => {
    const result = classifySupervisorFailure({
      evidence: { file_path: "factories/example-trading/graphs/domain.dot" },
    });
    assert.equal(result.classification, "local");
    assert.equal(result.rationale, "path_signal");
  });

  it("evidence.file_path in factories/mothership/graphs yields platform via path_signal", () => {
    const result = classifySupervisorFailure({
      evidence: { file_path: "factories/mothership/graphs/tick.dot" },
    });
    assert.equal(result.classification, "platform");
    assert.equal(result.rationale, "path_signal");
  });

  it("sourceRepo === controlPlaneRepo yields platform via control_plane_repo_match", () => {
    const result = classifySupervisorFailure({
      sourceRepo: "recallnet/astrochicken",
      controlPlaneRepo: "recallnet/astrochicken",
    });
    assert.equal(result.classification, "platform");
    assert.equal(result.rationale, "control_plane_repo_match");
  });

  it("sourceRepo !== controlPlaneRepo yields local via managed_target_repo", () => {
    const result = classifySupervisorFailure({
      sourceRepo: "example/external-factory",
      controlPlaneRepo: "recallnet/astrochicken",
    });
    assert.equal(result.classification, "local");
    assert.equal(result.rationale, "managed_target_repo");
  });

  it("sourceFactory !== factoryId yields local via source_factory_differs", () => {
    const result = classifySupervisorFailure({
      sourceFactory: "example-trading",
      factoryId: "mothership",
    });
    assert.equal(result.classification, "local");
    assert.equal(result.rationale, "source_factory_differs");
  });

  it("hint beats ownership (priority chain)", () => {
    const result = classifySupervisorFailure({
      classificationHint: "local",
      evidence: { ownership_hint: "control_plane" },
    });
    assert.equal(result.classification, "local");
    assert.equal(result.rationale, "explicit_hint");
  });

  it("ownership beats path (priority chain)", () => {
    const result = classifySupervisorFailure({
      evidence: {
        ownership_hint: "local_factory",
        file_path: "packages/factory-ops/src/foo.mjs",
      },
    });
    assert.equal(result.classification, "local");
    assert.equal(result.rationale, "ownership_hint");
  });

  it("path beats repo match (priority chain)", () => {
    const result = classifySupervisorFailure({
      evidence: { file_path: "factories/example-trading/graphs/domain.dot" },
      sourceRepo: "recallnet/astrochicken",
      controlPlaneRepo: "recallnet/astrochicken",
    });
    assert.equal(result.classification, "local");
    assert.equal(result.rationale, "path_signal");
  });

  it("infers crash_type from bugType", () => {
    const result = classifySupervisorFailure({ bugType: "factory-cli-runtime-crash" });
    assert.equal(result.crash_type, "runtime_module_error");
  });

  it("infers crash_type build_or_test_failure from main-branch-test-failure", () => {
    const result = classifySupervisorFailure({ bugType: "main-branch-test-failure" });
    assert.equal(result.crash_type, "build_or_test_failure");
  });

  it("infers crash_type stalled_execution from stalled-wave-execution", () => {
    const result = classifySupervisorFailure({ bugType: "stalled-wave-execution" });
    assert.equal(result.crash_type, "stalled_execution");
  });

  it("crashTypeHint overrides bugType inference", () => {
    const result = classifySupervisorFailure({
      bugType: "factory-cli-runtime-crash",
      crashTypeHint: "module_not_found",
    });
    assert.equal(result.crash_type, "module_not_found");
  });
});

describe("deriveIncidentSeverity", () => {
  it("returns informational with no arguments", () => {
    assert.equal(deriveIncidentSeverity(), "informational");
  });

  it("crashType=runtime_module_error yields blocking", () => {
    assert.equal(
      deriveIncidentSeverity({ crashType: "runtime_module_error" }),
      "blocking",
    );
  });

  it("crashType=module_not_found yields blocking", () => {
    assert.equal(
      deriveIncidentSeverity({ crashType: "module_not_found" }),
      "blocking",
    );
  });

  it("crashType=merge_marker_in_executable yields blocking", () => {
    assert.equal(
      deriveIncidentSeverity({ crashType: "merge_marker_in_executable" }),
      "blocking",
    );
  });

  it("crashType=module_export_contract_mismatch yields blocking", () => {
    assert.equal(
      deriveIncidentSeverity({ crashType: "module_export_contract_mismatch" }),
      "blocking",
    );
  });

  it("bugType=factory-cli-runtime-crash yields blocking", () => {
    assert.equal(
      deriveIncidentSeverity({ bugType: "factory-cli-runtime-crash" }),
      "blocking",
    );
  });

  it("bugType=main-branch-test-failure yields blocking", () => {
    assert.equal(
      deriveIncidentSeverity({ bugType: "main-branch-test-failure" }),
      "blocking",
    );
  });

  it("classification=platform with non-blocking crash yields degrading", () => {
    assert.equal(
      deriveIncidentSeverity({
        classification: "platform",
        crashType: "stalled_execution",
      }),
      "degrading",
    );
  });

  it("classification=local with non-blocking crash yields informational", () => {
    assert.equal(
      deriveIncidentSeverity({
        classification: "local",
        crashType: "stalled_execution",
      }),
      "informational",
    );
  });

  it("classification=needs-triage with non-blocking crash yields informational", () => {
    assert.equal(
      deriveIncidentSeverity({
        classification: "needs-triage",
        crashType: "unknown",
      }),
      "informational",
    );
  });
});
