import test from "node:test";
import assert from "node:assert/strict";

import { renderDotToPng } from "./lib/workflow-diagram-png.ts";

test("renderDotToPng renders deterministic PNG bytes from DOT", async () => {
  const dot = [
    "digraph demo_flow {",
    '    label = "demo_flow"',
    "    start [shape=Mdiamond]",
    "    done [shape=Msquare]",
    "    start -> done",
    "}",
    "",
  ].join("\n");

  const first = await renderDotToPng(dot);
  const second = await renderDotToPng(dot);

  assert.deepEqual(first, second);
  assert.equal(first.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("renderDotToPng ignores Hatch @import directives before rasterizing", async () => {
  const png = await renderDotToPng([
    '@import "factories/mothership/roles.stylesheet"',
    "",
    "digraph imported_demo {",
    '    label = "imported_demo"',
    "    start [shape=Mdiamond]",
    "    done [shape=Msquare]",
    "    start -> done",
    "}",
    "",
  ].join("\n"));

  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});
