import assert from "node:assert/strict";
import test from "node:test";

import { analyzeReactorDispatchScope } from "./check-reactor-dispatch-contract.ts";

test("reactor dispatch contract passes for governed mothership surfaces", () => {
  const analysis = analyzeReactorDispatchScope({ allTracked: true });

  assert.equal(analysis.ok, true);
  assert.equal(analysis.report.dispatch_graph, "factories/mothership/workflows/dispatch-control/factory_dispatch_reactor.workflow-source.mjs");
  assert.equal(analysis.report.supervisor_graph, "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs");
  assert.equal(Array.isArray(analysis.report.diagnostics), true);
  assert.equal(analysis.report.diagnostics.length, 0);
  assert.match(analysis.rendered_markdown, /^---\ndoc_type: "reference"\nowner: "platform-architecture"/);
  assert.match(analysis.rendered_markdown, /review_policy: "periodic-7"/);
});

test("reactor dispatch contract skips unrelated staged paths", () => {
  const analysis = analyzeReactorDispatchScope({
    stagedFileList: "/dev/null",
  });

  assert.equal(analysis.ok, true);
});
