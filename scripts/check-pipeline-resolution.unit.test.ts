import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractPipelineRefs, verifyPipelineResolution } from "./lib/pipeline-resolution-gate.ts";

describe("extractPipelineRefs", () => {
  it("extracts pipeline= from workflow source data.json nodes", () => {
    const data = {
      nodes: [
        { id: "foo", dotAttributes: { pipeline: "@hatch/pkg/workflows/bar/bar.workflow-source.mjs" } },
        { id: "baz", dotAttributes: { type: "tool" } },
      ],
    };
    const refs = extractPipelineRefs({ dataJson: data, filePath: "test.data.json" });
    assert.equal(refs.length, 1);
    assert.equal(refs[0].ref, "@hatch/pkg/workflows/bar/bar.workflow-source.mjs");
    assert.equal(refs[0].nodeId, "foo");
    assert.equal(refs[0].kind, "pipeline");
  });

  it("extracts template= from workflow source data.json nodes", () => {
    const data = {
      nodes: [
        { id: "fan", dotAttributes: { template: "@hatch/pkg/workflows/sub/sub.workflow-source.mjs" } },
      ],
    };
    const refs = extractPipelineRefs({ dataJson: data, filePath: "test.data.json" });
    assert.equal(refs.length, 1);
    assert.equal(refs[0].kind, "template");
  });

  it("extracts pipeline= from DOT file content", () => {
    const dot = `
      foo [type="pipeline" pipeline="@hatch/pkg/workflows/bar/bar.workflow-source.mjs"]
      baz [type="tool" action_id="something"]
    `;
    const refs = extractPipelineRefs({ dotContent: dot, filePath: "test.dot" });
    assert.equal(refs.length, 1);
    assert.equal(refs[0].ref, "@hatch/pkg/workflows/bar/bar.workflow-source.mjs");
  });

  it("skips factory-local references (factories/*)", () => {
    const data = {
      nodes: [
        { id: "local", dotAttributes: { pipeline: "factories/mothership/graphs/goal_execute.dot" } },
      ],
    };
    const refs = extractPipelineRefs({ dataJson: data, filePath: "test.data.json" });
    assert.equal(refs.length, 0, "factory-local refs are resolved differently and should be skipped");
  });
});

describe("verifyPipelineResolution", () => {
  it("returns ok when all refs resolve", () => {
    const refs = [
      { ref: "@hatch/capability-artifact-ingestion/workflows/artifact_ingest/artifact_ingest.workflow-source.mjs", nodeId: "test", kind: "pipeline", filePath: "test.json" },
    ];
    const result = verifyPipelineResolution({ refs, resolveFrom: process.cwd() + "/apps/hatch" });
    assert.equal(result.ok, true);
    assert.equal(result.failures.length, 0);
  });

  it("returns failures for unresolvable refs", () => {
    const refs = [
      { ref: "@hatch/nonexistent-package/graphs/missing.dot", nodeId: "broken", kind: "pipeline", filePath: "test.json" },
    ];
    const result = verifyPipelineResolution({ refs, resolveFrom: process.cwd() + "/apps/hatch" });
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].nodeId, "broken");
    assert.ok(result.failures[0].error.includes("nonexistent-package"));
  });

  it("resolves real workflow source .mjs references", () => {
    const refs = [
      { ref: "@hatch/capability-artifact-ingestion/workflows/artifact_ingest/artifact_ingest.workflow-source.mjs", nodeId: "ai", kind: "pipeline", filePath: "test.json" },
    ];
    const result = verifyPipelineResolution({ refs, resolveFrom: process.cwd() + "/apps/hatch" });
    assert.equal(result.ok, true, "real workflow source must resolve");
  });
});
