import assert from "node:assert/strict";
import test from "node:test";

import { loadGraphSemanticsText } from "../../../../scripts/lib/load-graph-semantics.ts";

const DOT_CACHE = {};
function readDot(name) {
  if (!DOT_CACHE[name]) {
    DOT_CACHE[name] = loadGraphSemanticsText(
      `factories/mothership/workflows/dispatch-control/${name}.workflow-source.mjs`,
    );
  }
  return DOT_CACHE[name];
}

function extractNode(dot, name) {
  const re = new RegExp(`${name}\\s*\\[[\\s\\S]*?\\]`);
  return dot.match(re)?.[0] || "";
}

function parseEdges(dot) {
  const edges = [];
  for (const rawLine of String(dot || "").split("\n")) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line || !line.includes("->")) continue;
    if (!/^[A-Za-z0-9_]+\s*->/.test(line)) continue;

    const noSemicolon = line.replace(/;\s*$/, "");
    const attrMatch = noSemicolon.match(/\[([^\]]+)\]\s*$/);
    const attrs = attrMatch?.[1] || "";
    const condition = (attrs.match(/condition\s*=\s*"([^"]+)"/)?.[1] || "").trim();
    const edgePath = attrMatch
      ? noSemicolon.slice(0, attrMatch.index).trim()
      : noSemicolon;

    const nodes = edgePath.split("->").map((part) => part.trim()).filter(Boolean);
    if (nodes.length < 2) continue;

    for (let i = 0; i < nodes.length - 1; i += 1) {
      edges.push({ from: nodes[i], to: nodes[i + 1], condition });
    }
  }
  return edges;
}

function outgoing(edges, from) {
  return edges.filter((edge) => edge.from === from);
}

function hasEdge(edges, { from, to, condition = null }) {
  return edges.some((edge) => edge.from === from
    && edge.to === to
    && (condition === null || edge.condition === condition));
}

test("fast-route telemetry nodes exist as reversible tool markers between bug gate branches", () => {
  const dot = readDot("factory_supervisor_tick");
  const openNode = extractNode(dot, "fast_route_telemetry_open");
  const clearNode = extractNode(dot, "fast_route_telemetry_clear");

  assert.ok(openNode, "fast_route_telemetry_open node is required");
  assert.ok(clearNode, "fast_route_telemetry_clear node is required");

  assert.match(openNode, /type="tool"/);
  assert.match(openNode, /governance="reversible"/);
  assert.match(openNode, /output_key="fast_route_branch_marker"/);
  assert.match(openNode, /fast-route-open/);

  assert.match(clearNode, /type="tool"/);
  assert.match(clearNode, /governance="reversible"/);
  assert.match(clearNode, /output_key="fast_route_branch_marker"/);
  assert.match(clearNode, /fast-route-clear/);

  assert.match(dot, /bug_fast_gate -> fast_route_telemetry_open \[condition="has_open_bugs=true"\]/);
  assert.match(dot, /fast_route_telemetry_open -> set_date_fast/);
  assert.match(dot, /bug_fast_gate -> fast_route_telemetry_clear \[condition="has_open_bugs!=true"\]/);
  assert.match(dot, /fast_route_telemetry_clear -> recovery_sweep_runtime/);

  // Telemetry markers must be mandatory path nodes (no direct bypass edges).
  assert.doesNotMatch(dot, /bug_fast_gate -> set_date_fast \[condition="has_open_bugs=true"\]/);
  assert.doesNotMatch(dot, /bug_fast_gate -> recovery_sweep_runtime \[condition="has_open_bugs!=true"\]/);
});

test("open-bug fast-route branch preserves strict node ordering and forbids bypass edges", () => {
  const edges = parseEdges(readDot("factory_supervisor_tick"));
  const fastRouteChain = [
    "snapshot_state_fast",
    "evaluate_open_bug_gate_fast",
    "bug_fast_gate",
    "fast_route_telemetry_open",
    "set_date_fast",
    "load_supervisor_bug_fast_task_prompt",
    "supervisor_review_bug_fast",
    "evaluate_open_bug_gate_after_fast",
    "bug_fast_resolution_gate",
  ];

  for (let i = 0; i < fastRouteChain.length - 1; i += 1) {
    const from = fastRouteChain[i];
    const to = fastRouteChain[i + 1];
    assert.ok(
      hasEdge(edges, { from, to }),
      `missing required fast-route edge ${from} -> ${to}`,
    );
  }

  assert.ok(
    hasEdge(edges, {
      from: "bug_fast_gate",
      to: "fast_route_telemetry_open",
      condition: "has_open_bugs=true",
    }),
    "bug_fast_gate -> fast_route_telemetry_open must be conditioned on has_open_bugs=true",
  );

  const forbiddenBypassTargets = new Set(["recovery_sweep_runtime", "goal_gate", "fan_out_wave_execute"]);
  for (const nodeId of fastRouteChain.slice(0, -1)) {
    for (const edge of outgoing(edges, nodeId)) {
      assert.ok(
        !forbiddenBypassTargets.has(edge.to),
        `${nodeId} must not bypass fast-route into ${edge.to}`,
      );
    }
  }

  for (const forbiddenTarget of ["goal_gate", "fan_out_wave_execute"]) {
    assert.equal(
      outgoing(edges, "bug_fast_resolution_gate").some((edge) => edge.to === forbiddenTarget),
      false,
      `bug_fast_resolution_gate must not route directly to ${forbiddenTarget}`,
    );
  }
});

test("bug_fast_resolution_gate conditions are deterministic and route unresolved bugs to done only", () => {
  const edges = parseEdges(readDot("factory_supervisor_tick"));
  const resolutionEdges = outgoing(edges, "bug_fast_resolution_gate");

  assert.deepEqual(
    [...new Set(resolutionEdges.map((edge) => edge.to))].sort(),
    ["done", "recovery_sweep_runtime"],
    "bug_fast_resolution_gate must branch only to done or recovery_sweep_runtime",
  );

  const toDone = resolutionEdges.filter((edge) => edge.to === "done");
  const toRecovery = resolutionEdges.filter((edge) => edge.to === "recovery_sweep_runtime");

  assert.equal(toDone.length, 1, "bug_fast_resolution_gate must emit exactly one edge to done");
  assert.equal(toRecovery.length, 1, "bug_fast_resolution_gate must emit exactly one edge to recovery_sweep_runtime");

  assert.equal(
    toDone[0].condition,
    "has_open_bugs=true",
    "unresolved-bug branch must be bug_fast_resolution_gate -> done [condition=has_open_bugs=true]",
  );
  assert.equal(
    toRecovery[0].condition,
    "has_open_bugs!=true",
    "resolved-bug branch must be bug_fast_resolution_gate -> recovery_sweep_runtime [condition=has_open_bugs!=true]",
  );
});

test("snapshot_state_after_bug_fast is removed — redundant snapshot whose output was never consumed", () => {
  const dot = readDot("factory_supervisor_tick");
  assert.doesNotMatch(
    dot,
    /snapshot_state_after_bug_fast/,
    "snapshot_state_after_bug_fast must not exist — its output was write-only (evaluate_open_bug_gate_after_fast queries GitHub directly)",
  );
});
