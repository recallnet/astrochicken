export const PHASE1_GATE_SCOPE_CONTRACT = Object.freeze({
  graph_transport: Object.freeze({
    gateId: "typed_action_graph_transport",
    command: "node",
    args: Object.freeze([
      "scripts/check-internal-cli-transport.ts",
      "--fail-active-graphs",
      "--active-graphs-only",
    ]),
    failureTarget: "check-internal-cli-transport",
    profiles: Object.freeze(["fast", "strict", "full"]),
    runtime: Object.freeze({ stagedFileList: true }),
    surfaceType: "graph",
    classifications: Object.freeze(["active_factory", "active_runtime"]),
    violationKind: "graph_internal_cli_transport",
  }),
  runtime_internal_cli: Object.freeze({
    gateId: "runtime_internal_cli_repo_wide",
    command: "node",
    args: Object.freeze(["scripts/check-runtime-internal-cli-enforcement.ts"]),
    failureTarget: "check-runtime-internal-cli-enforcement",
    profiles: Object.freeze(["fast", "strict", "full"]),
    runtime: Object.freeze({ stagedFileList: true }),
    surfaceType: "runtime",
    classifications: Object.freeze(["hot_path", "execution_path"]),
    violationKind: "runtime_internal_cli_transport",
  }),
  command_thinness: Object.freeze({
    gateId: "command_thinness_active_owner_surface",
    command: "node",
    args: Object.freeze(["scripts/check-command-thinness-enforcement.ts"]),
    failureTarget: "check-command-thinness-enforcement",
    profiles: Object.freeze(["fast", "strict", "full"]),
    runtime: Object.freeze({ stagedFileList: true }),
    surfaceType: "command",
    classifications: Object.freeze(["active_deterministic_owner"]),
    violationKind: "command_thinness_hotspot",
  }),
});

export const PHASE1_GATE_SCOPE_ENTRIES = Object.freeze(Object.values(PHASE1_GATE_SCOPE_CONTRACT));
export const PHASE1_GATE_SCOPE_IDS = Object.freeze(PHASE1_GATE_SCOPE_ENTRIES.map((entry) => entry.gateId));
