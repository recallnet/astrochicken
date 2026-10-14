import assert from "node:assert/strict";
import test from "node:test";

import { loadGraphSemanticsText } from "./load-graph-semantics.ts";

test("loadGraphSemanticsText renders workflow source modules to DOT", () => {
  const rendered = loadGraphSemanticsText("packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs");
  assert.match(rendered, /digraph release_report_flow/);
  assert.match(rendered, /publish_release_report \[/);
});

test("graph semantics accepts canonical inline workflow modules without a sidecar", () => {
 const rendered = loadGraphSemanticsText("factories/mothership/workflows/daily-reporting/daily_lens_publish.workflow-source.mjs");
 assert.match(rendered, /digraph daily_lens_publish/);
});
