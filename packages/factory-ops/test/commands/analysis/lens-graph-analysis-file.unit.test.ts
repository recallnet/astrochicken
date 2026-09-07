import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { materializePendingAnalysisFromAgentResult } from "../../../src/commands/analysis/lens-graph-analysis-file.ts";

function makePendingStub() {
  return { status: "pending_agent_analysis", bundle_manifest_path: "/tmp/test" };
}

describe("materializePendingAnalysisFromAgentResult", () => {
  it("returns analysisRaw unchanged when status is not pending", async () => {
    const existing = { report_body: "hello", executive_summary: {} };
    const result = await materializePendingAnalysisFromAgentResult({
      analysisRaw: existing,
      agentResultJson: '{"report_body":"new"}',
      writeJsonFileAtomic: async () => {},
    });
    assert.equal(result, existing);
  });

  it("materializes from valid agentResultJson when analysis is pending", async () => {
    let writtenData = null;
    const agentResult = { report_body: "test report", executive_summary: { headline: "ok" } };
    const result = await materializePendingAnalysisFromAgentResult({
      runtimeFs: {},
      analysisPath: "/tmp/out.json",
      analysisRaw: makePendingStub(),
      agentResultJson: JSON.stringify(agentResult),
      writeJsonFileAtomic: async (_fs, _path, data) => { writtenData = data; },
    });
    assert.equal(result.report_body, "test report");
    assert.deepStrictEqual(writtenData, agentResult);
  });

  it("returns pending stub when agentResultJson is empty", async () => {
    const stub = makePendingStub();
    const result = await materializePendingAnalysisFromAgentResult({
      analysisRaw: stub,
      agentResultJson: "",
      writeJsonFileAtomic: async () => {},
    });
    assert.equal(result.status, "pending_agent_analysis");
  });

  it("extracts embedded JSON from prose text in agentResultJson", async () => {
    let writtenData = null;
    const proseWithJson = 'Here is the analysis:\n{"report_body":"extracted","executive_summary":{"headline":"found"}}\nDone.';
    const result = await materializePendingAnalysisFromAgentResult({
      runtimeFs: {},
      analysisPath: "/tmp/out.json",
      analysisRaw: makePendingStub(),
      agentResultJson: proseWithJson,
      writeJsonFileAtomic: async (_fs, _path, data) => { writtenData = data; },
    });
    assert.equal(result.report_body, "extracted");
    assert.ok(writtenData, "must write extracted JSON to file");
  });

  it("returns pending stub when prose contains no extractable JSON", async () => {
    const pureProse = "The analysis shows 9 commits and 3 failures. No JSON here.";
    const result = await materializePendingAnalysisFromAgentResult({
      analysisRaw: makePendingStub(),
      agentResultJson: pureProse,
      writeJsonFileAtomic: async () => {},
    });
    assert.equal(result.status, "pending_agent_analysis");
  });
});
