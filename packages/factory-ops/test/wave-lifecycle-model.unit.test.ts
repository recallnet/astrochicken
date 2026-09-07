import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Wave Marker Lifecycle — Declarative State Machine Model
// ---------------------------------------------------------------------------
// Every state a "Wave Ready:" marker issue can occupy, and every transition
// between states.  The model is the single source of truth; graph-analysis
// tests below verify structural invariants (no infinite loops, no dead ends,
// terminal isolation).  Transition-verification tests in sibling files call
// the real pure functions.
// ---------------------------------------------------------------------------

const STATES = {
  NONE:              { terminal: false, desc: "no marker exists" },
  OPEN_READY:        { terminal: false, desc: "open + [ready]" },
  OPEN_IN_PROGRESS:  { terminal: false, desc: "open + [ready, wave-in-progress] + claimed" },
  OPEN_NO_LABELS:    { terminal: false, desc: "open + [] (stripped by legacy block-ready)" },
  CLOSED_COMPLETED:  { terminal: true,  desc: "closed (completed)" },
  CLOSED_BLOCKED:    { terminal: true,  desc: "closed (no_merge_candidates | judge_failed)" },
  CLOSED_STALE:      { terminal: true,  desc: "closed (orphan sanitize)" },
};

const TRANSITIONS = [
  // --- happy path ---
  { from: "NONE",              event: "dispatch_creates",    to: "OPEN_READY",        requiresExternalChange: false },
  { from: "OPEN_READY",        event: "execute_claims",      to: "OPEN_IN_PROGRESS",  requiresExternalChange: false },
  { from: "OPEN_IN_PROGRESS",  event: "execute_succeeds",    to: "CLOSED_COMPLETED",  requiresExternalChange: false },

  // --- failure paths ---
  { from: "OPEN_IN_PROGRESS",  event: "no_merge_candidates", to: "CLOSED_BLOCKED",    requiresExternalChange: false },
  { from: "OPEN_IN_PROGRESS",  event: "judge_failed",        to: "CLOSED_BLOCKED",    requiresExternalChange: false },

  // Deterministic judge-failure recovery: if actionable work remains, re-enter OPEN_READY
  // and emit a wave-judge-requeue artifact carrying the decision payload.
  { from: "CLOSED_BLOCKED",    event: "judge_failure_requeue", to: "OPEN_READY",      requiresExternalChange: true, metadataArtifact: "wave-judge-requeue" },

  // --- recovery paths (require external conditions: concurrent lock holder / time) ---
  { from: "OPEN_IN_PROGRESS",  event: "lock_fails",           to: "OPEN_READY",       requiresExternalChange: true },
  { from: "OPEN_IN_PROGRESS",  event: "stale_lease_expires",  to: "OPEN_READY",       requiresExternalChange: true },

  // --- crash recovery: block-ready crashes after label strip but before close ---
  { from: "OPEN_IN_PROGRESS",  event: "block_ready_crashes",  to: "OPEN_NO_LABELS",   requiresExternalChange: true },

  // --- sanitize paths (legacy OPEN_NO_LABELS — only from crash recovery) ---
  { from: "OPEN_NO_LABELS",    event: "sanitize_no_lease",   to: "CLOSED_STALE",      requiresExternalChange: false },
  { from: "OPEN_NO_LABELS",    event: "sanitize_has_lease",  to: "OPEN_IN_PROGRESS",  requiresExternalChange: false },

  // --- re-dispatch from stale (only when external conditions changed) ---
  { from: "CLOSED_STALE",      event: "dispatch_reopens",    to: "OPEN_READY",        requiresExternalChange: true },
];

// ---------------------------------------------------------------------------
// Graph utilities
// ---------------------------------------------------------------------------

function adjacency(transitions) {
  const adj = new Map();
  for (const t of transitions) {
    if (!adj.has(t.from)) adj.set(t.from, []);
    adj.get(t.from).push(t);
  }
  return adj;
}

function allStates() {
  return Object.keys(STATES);
}

function terminalStates() {
  return allStates().filter((s) => STATES[s].terminal);
}

function nonTerminalStates() {
  return allStates().filter((s) => !STATES[s].terminal);
}

// BFS reachability from a given state.
function reachableFrom(start, transitions) {
  const adj = adjacency(transitions);
  const visited = new Set();
  const queue = [start];
  while (queue.length > 0) {
    const s = queue.shift();
    if (visited.has(s)) continue;
    visited.add(s);
    for (const t of adj.get(s) || []) {
      queue.push(t.to);
    }
  }
  return visited;
}

// Reverse reachability: can we reach `target` from `start`?
function canReach(start, target, transitions) {
  return reachableFrom(start, transitions).has(target);
}

// Find all simple cycles (DFS-based).
function findCycles(transitions) {
  const adj = adjacency(transitions);
  const cycles = [];

  function dfs(node, path, visited) {
    if (visited.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart >= 0) {
        cycles.push(path.slice(cycleStart).concat(node));
      }
      return;
    }
    visited.add(node);
    path.push(node);
    for (const t of adj.get(node) || []) {
      dfs(t.to, [...path], new Set(visited));
    }
  }

  for (const state of allStates()) {
    dfs(state, [], new Set());
  }
  return cycles;
}

// Get transitions forming a cycle.
function cycleTransitions(cycle, transitions) {
  const result = [];
  for (let i = 0; i < cycle.length - 1; i++) {
    const from = cycle[i];
    const to = cycle[i + 1];
    const t = transitions.find((tr) => tr.from === from && tr.to === to);
    if (t) result.push(t);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Graph Analysis Tests
// ---------------------------------------------------------------------------

test("every non-terminal state is reachable from NONE", () => {
  const reachable = reachableFrom("NONE", TRANSITIONS);
  for (const state of nonTerminalStates()) {
    assert.ok(reachable.has(state), `${state} is NOT reachable from NONE`);
  }
});

test("every non-terminal state has a path to at least one terminal state", () => {
  const terminals = terminalStates();
  for (const state of nonTerminalStates()) {
    const reachable = reachableFrom(state, TRANSITIONS);
    const canReachTerminal = terminals.some((t) => reachable.has(t));
    assert.ok(canReachTerminal, `${state} has no path to any terminal state (dead end)`);
  }
});

test("no terminal state has outgoing transitions", () => {
  const adj = adjacency(TRANSITIONS);
  for (const state of terminalStates()) {
    const outgoing = adj.get(state) || [];
    // CLOSED_STALE can transition to OPEN_READY (dispatch_reopens) — this is allowed
    // because it requires external change. Filter those out.
    const nonConditional = outgoing.filter((t) => !t.requiresExternalChange);
    assert.equal(nonConditional.length, 0,
      `terminal state ${state} has unconditional outgoing transitions: ${nonConditional.map((t) => t.event).join(", ")}`);
  }
});

test("CLOSED_BLOCKED only re-enters OPEN_READY via externalized judge_failure_requeue artifact path", () => {
  const outgoing = TRANSITIONS.filter((t) => t.from === "CLOSED_BLOCKED");
  assert.equal(outgoing.length, 1,
    `CLOSED_BLOCKED should have exactly one controlled recovery edge. Found: ${outgoing.map((t) => `--[${t.event}]--> ${t.to}`).join(", ")}`);

  const edge = outgoing[0];
  assert.equal(edge.event, "judge_failure_requeue");
  assert.equal(edge.to, "OPEN_READY");
  assert.equal(edge.requiresExternalChange, true);
  assert.equal(edge.metadataArtifact, "wave-judge-requeue");
});

test("CLOSED_COMPLETED has zero outgoing transitions", () => {
  const adj = adjacency(TRANSITIONS);
  const outgoing = adj.get("CLOSED_COMPLETED") || [];
  assert.equal(outgoing.length, 0, "CLOSED_COMPLETED must be fully terminal");
});

test("every cycle contains at least one requiresExternalChange edge", () => {
  const cycles = findCycles(TRANSITIONS);
  for (const cycle of cycles) {
    const edges = cycleTransitions(cycle, TRANSITIONS);
    const hasExternal = edges.some((t) => t.requiresExternalChange);
    assert.ok(hasExternal,
      `infinite loop detected: ${cycle.join(" → ")} — none of its edges require an external state change`);
  }
});

test("OPEN_NO_LABELS cannot reach OPEN_READY without passing through a terminal state", () => {
  // After the fix, block-ready goes to CLOSED_BLOCKED (not OPEN_NO_LABELS).
  // But OPEN_NO_LABELS still exists in the model for legacy/crash recovery.
  // Verify: OPEN_NO_LABELS can only reach OPEN_READY via CLOSED_STALE (terminal).
  const directTransitions = TRANSITIONS.filter(
    (t) => t.from === "OPEN_NO_LABELS" && t.to === "OPEN_READY"
  );
  assert.equal(directTransitions.length, 0,
    "OPEN_NO_LABELS must NOT have a direct transition to OPEN_READY");
});

test("model covers all declared states as transition sources or targets", () => {
  const mentioned = new Set();
  for (const t of TRANSITIONS) {
    mentioned.add(t.from);
    mentioned.add(t.to);
  }
  for (const state of allStates()) {
    assert.ok(mentioned.has(state), `state ${state} is declared but never used in any transition`);
  }
});

test("no duplicate transitions (same from+event)", () => {
  const seen = new Set();
  for (const t of TRANSITIONS) {
    const key = `${t.from}:${t.event}`;
    assert.ok(!seen.has(key), `duplicate transition: ${key}`);
    seen.add(key);
  }
});

test("every transition references valid states", () => {
  for (const t of TRANSITIONS) {
    assert.ok(STATES[t.from], `transition ${t.event}: unknown from-state "${t.from}"`);
    assert.ok(STATES[t.to], `transition ${t.event}: unknown to-state "${t.to}"`);
  }
});

// ---------------------------------------------------------------------------
// Model completeness sentinel — forces model update when code changes
// ---------------------------------------------------------------------------

test("transition count sentinel — update model when adding new transitions", () => {
  // If you add a new state transition to the wave lifecycle, you MUST:
  // 1. Add the transition to TRANSITIONS above
  // 2. Update this count
  // 3. Verify all graph analysis tests still pass
  assert.equal(TRANSITIONS.length, 12,
    `Expected 12 transitions but found ${TRANSITIONS.length}. ` +
    "If you added a new wave lifecycle transition, add it to TRANSITIONS " +
    "and update this sentinel count.");
});

test("state count sentinel — update model when adding new states", () => {
  assert.equal(allStates().length, 7,
    `Expected 7 states but found ${allStates().length}. ` +
    "If you added a new wave marker state, add it to STATES " +
    "and update this sentinel count.");
});

// ---------------------------------------------------------------------------
// Illegal transition tests — the specific bugs that caused the #452 loop
// ---------------------------------------------------------------------------

test("CLOSED_BLOCKED -> OPEN_READY is only legal through judge_failure_requeue + wave-judge-requeue metadata", () => {
  const edges = TRANSITIONS.filter(
    (t) => t.from === "CLOSED_BLOCKED" && t.to === "OPEN_READY"
  );
  assert.equal(edges.length, 1, "Expected exactly one CLOSED_BLOCKED -> OPEN_READY edge");
  assert.equal(edges[0].event, "judge_failure_requeue");
  assert.equal(edges[0].requiresExternalChange, true);
  assert.equal(edges[0].metadataArtifact, "wave-judge-requeue");
});

test("no unconditional cycle exists among non-terminal states", () => {
  // Build a subgraph of only non-terminal states with non-requiresExternalChange edges.
  const unconditional = TRANSITIONS.filter(
    (t) => !t.requiresExternalChange && !STATES[t.from]?.terminal && !STATES[t.to]?.terminal
  );
  const cycles = findCycles(unconditional);
  // Filter out trivial cycles (length 1 = same state, impossible since we have no self-loops)
  const realCycles = cycles.filter((c) => c.length > 2);
  assert.equal(realCycles.length, 0,
    `unconditional cycle among non-terminal states: ${realCycles.map((c) => c.join(" → ")).join("; ")}`);
});
