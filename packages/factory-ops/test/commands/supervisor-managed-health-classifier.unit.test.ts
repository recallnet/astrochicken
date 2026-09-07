import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyManagedLifecycleState } from "../../src/commands/supervisor-managed-health-classifier.ts";

function state(name) {
  return { lifecycle_state: name, health_state: name };
}

describe("classifyManagedLifecycleState", () => {
  // --- Individual states ---

  it("defaults to idle with no args", () => {
    assert.deepStrictEqual(classifyManagedLifecycleState(), state("idle"));
  });

  it("returns paused when controlGate is paused", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({ controlGate: "paused" }),
      state("paused"),
    );
  });

  it("returns draining when controlGate is draining", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({ controlGate: "draining" }),
      state("draining"),
    );
  });

  it("returns blocked_platform when hasOpenUpstreamBugs is true", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({ hasOpenUpstreamBugs: "true" }),
      state("blocked_platform"),
    );
  });

  it("returns blocked_local when hasActionItems is true", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({ hasActionItems: "true" }),
      state("blocked_local"),
    );
  });

  it("returns degraded when hasDomainFailure is true", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({ hasDomainFailure: "true" }),
      state("degraded"),
    );
  });

  it("returns active when hasSelectedWork is true", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({ hasSelectedWork: "true" }),
      state("active"),
    );
  });

  it("returns idle when all flags are false", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({
        controlGate: "",
        hasOpenUpstreamBugs: "false",
        hasActionItems: "false",
        hasSelectedWork: "false",
        hasDomainFailure: "false",
      }),
      state("idle"),
    );
  });

  // --- Priority precedence ---

  it("paused beats upstream bugs", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({
        controlGate: "paused",
        hasOpenUpstreamBugs: "true",
      }),
      state("paused"),
    );
  });

  it("draining beats upstream bugs", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({
        controlGate: "draining",
        hasOpenUpstreamBugs: "true",
      }),
      state("draining"),
    );
  });

  it("upstream bugs beat action items", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({
        hasOpenUpstreamBugs: "true",
        hasActionItems: "true",
      }),
      state("blocked_platform"),
    );
  });

  it("action items beat domain failure", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({
        hasActionItems: "true",
        hasDomainFailure: "true",
      }),
      state("blocked_local"),
    );
  });

  it("domain failure beats selected work", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({
        hasDomainFailure: "true",
        hasSelectedWork: "true",
      }),
      state("degraded"),
    );
  });

  it("selected work beats idle", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({ hasSelectedWork: "true" }),
      state("active"),
    );
  });

  // --- Edge cases ---

  it("trims whitespace from controlGate", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({ controlGate: " paused " }),
      state("paused"),
    );
  });

  it("all explicit false strings yield idle", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({
        hasOpenUpstreamBugs: "false",
        hasActionItems: "false",
        hasSelectedWork: "false",
        hasDomainFailure: "false",
      }),
      state("idle"),
    );
  });

  it("all empty strings yield idle", () => {
    assert.deepStrictEqual(
      classifyManagedLifecycleState({
        controlGate: "",
        hasOpenUpstreamBugs: "",
        hasActionItems: "",
        hasSelectedWork: "",
        hasDomainFailure: "",
      }),
      state("idle"),
    );
  });
});
