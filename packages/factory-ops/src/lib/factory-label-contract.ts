import { gh, ghJson } from "./cli-helpers.ts";

export const FACTORY_LABEL_KEYS = Object.freeze({
  GOAL: "goal",
  FEATURE: "feature",
  BUG: "bug",
  READY: "ready",
  WAVE_IN_PROGRESS: "wave_in_progress",
  TRIAGED: "triaged",
  DUPLICATE: "duplicate",
  NOT_PLANNED: "not_planned",
  PRIORITIES: "priorities",
  ARTIFACTS: "artifacts",
  TELEMETRY: "telemetry",
  QUARANTINED: "quarantined",
  DEFERRED: "deferred",
  FACTORY_TRACKING: "factory_tracking",
  PROCESS: "process",
  BLOCKED_CONTROL_PLANE: "blocked_control_plane",
  MERGE_FOLLOWUP: "merge_followup",
  MANAGED_FACTORY_BUG: "managed_factory_bug",
  HUMAN: "human",
  AWAITING_HUMAN: "awaiting_human",
  BLOCKED: "blocked",
  BRAINSTORM: "brainstorm",
  KIND_EXAMPLE_SCANNER: "kind_example_scanner",
  KIND_BRAINSTORM: "kind_brainstorm",
  KIND_MOTHERSHIP: "kind_mothership",
  KIND_EXAMPLE_WEB: "kind_example_web",
  KIND_EXAMPLE_TRADING: "kind_example_trading",
  KIND_RESEARCH: "kind_research",
  FACTORY_EXAMPLE_WEB: "factory_example_web",
  FACTORY_EXAMPLE_TRADING: "factory_example_trading",
  FACTORY_EXAMPLE_WEB: "factory_example_web",
  INCIDENT_FINGERPRINT: "incident_fingerprint",
  RESEARCH_STAGE_HYPOTHESIS_FORMULATION: "research_stage_hypothesis_formulation",
  RESEARCH_STAGE_DATA_INFRASTRUCTURE: "research_stage_data_infrastructure",
  RESEARCH_STAGE_FEATURE_ENGINEERING_EDA: "research_stage_feature_engineering_eda",
  RESEARCH_STAGE_STRATEGY_DESIGN: "research_stage_strategy_design",
  RESEARCH_STAGE_BACKTESTING: "research_stage_backtesting",
  RESEARCH_STAGE_VERIFICATION_RED_TEAM: "research_stage_verification_red_team",
  RESEARCH_STAGE_SYNTHESIS: "research_stage_synthesis",
  RESEARCH_APPROVAL_PENDING: "research_approval_pending",
  RESEARCH_APPROVAL_APPROVED: "research_approval_approved",
  RESEARCH_APPROVAL_REJECTED: "research_approval_rejected",
  RESEARCH_VERDICT_PURSUE: "research_verdict_pursue",
  RESEARCH_VERDICT_INVESTIGATE: "research_verdict_investigate",
  RESEARCH_VERDICT_ARCHIVE: "research_verdict_archive",
  RESEARCH_VERDICT_MONITOR: "research_verdict_monitor",
});

const CORE_FACTORY_LABEL_SPECS = Object.freeze([
  {
    key: FACTORY_LABEL_KEYS.GOAL,
    name: "goal",
    description: "High-level goal",
    color: "0E8A16",
    semantics: "goal_type",
    class: "type",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: [
      "packages/factory-ops/src/commands/goal-queue-ops.ts",
      "packages/factory-ops/src/commands/release-build-report-context.ts",
    ],
    writer_paths: [],
  },
  {
    key: FACTORY_LABEL_KEYS.FEATURE,
    name: "feature",
    description: "Feature implementation",
    color: "0e8a16",
    semantics: "feature_type",
    class: "type",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: [
      "packages/factory-ops/src/commands/supervisor-state-snapshot.ts",
      "packages/factory-ops/src/commands/factory-outcomes.ts",
    ],
    writer_paths: [],
  },
  {
    key: FACTORY_LABEL_KEYS.BUG,
    name: "bug",
    description: "Something isn't working",
    color: "d73a4a",
    semantics: "bug_type",
    class: "type",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: [
      "packages/factory-ops/src/commands/factory-outcomes.ts",
      "packages/factory-ops/src/commands/goal-queue-ops.ts",
    ],
    writer_paths: [],
  },
  {
    key: FACTORY_LABEL_KEYS.READY,
    name: "ready",
    description: "Ready for execution",
    color: "0e8a16",
    semantics: "execution_ready",
    class: "lifecycle",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: [
      "packages/factory-ops/src/commands/goal-queue-ops.ts",
    ],
    writer_paths: [
      "packages/factory-ops/src/commands/goal-auto-ready-artifacts.ts",
    ],
  },
  {
    key: FACTORY_LABEL_KEYS.WAVE_IN_PROGRESS,
    name: "wave-in-progress",
    description: "Wave currently executing",
    color: "fbca04",
    semantics: "wave_active",
    class: "lifecycle",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: [
      "packages/factory-ops/src/commands/supervisor-state-snapshot.ts",
    ],
    writer_paths: [
      "packages/factory-ops/src/commands/goal-run-state.ts",
    ],
  },
  {
    key: FACTORY_LABEL_KEYS.TRIAGED,
    name: "triaged",
    description: "Triage completed",
    color: "0e8a16",
    semantics: "triage_complete",
    class: "workflow",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: ["packages/factory-ops/src/commands/supervisor-normalize-feature-labels.ts"],
    writer_paths: ["packages/factory-ops/src/commands/triage-apply-status.ts"],
  },
  {
    key: FACTORY_LABEL_KEYS.DUPLICATE,
    name: "duplicate",
    description: "This issue or pull request already exists",
    color: "cfd3d7",
    semantics: "duplicate_terminal",
    class: "workflow",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: ["packages/factory-ops/src/commands/triage-apply-terminal-status.ts"],
    writer_paths: [],
  },
  {
    key: FACTORY_LABEL_KEYS.NOT_PLANNED,
    name: "not-planned",
    description: "Issue was intentionally closed as not planned",
    color: "cfd3d7",
    semantics: "not_planned_terminal",
    class: "workflow",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: ["packages/factory-ops/src/commands/triage-apply-status.ts"],
    writer_paths: ["packages/factory-ops/src/commands/triage-apply-status.ts"],
  },
  {
    key: FACTORY_LABEL_KEYS.PRIORITIES,
    name: "priorities",
    description: "Current priorities",
    color: "5319e7",
    semantics: "queue_priority",
    class: "queue",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: [
      "packages/factory-ops/src/commands/goal-queue-ops.ts",
    ],
    writer_paths: [],
  },
  {
    key: FACTORY_LABEL_KEYS.ARTIFACTS,
    name: "artifacts",
    description: "Machine-generated artifacts",
    color: "5319e7",
    semantics: "artifact_tracking",
    class: "type",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: [
      "packages/factory-ops/src/commands/artifact-ingest.ts",
      "packages/factory-ops/src/commands/release-manifest.ts",
    ],
    writer_paths: ["packages/factory-ops/src/commands/supervisor-artifact.ts"],
  },
  {
    key: FACTORY_LABEL_KEYS.TELEMETRY,
    name: "telemetry",
    description: "Machine-generated supervisor telemetry",
    color: "1d76db",
    semantics: "telemetry_artifact",
    class: "type",
    shared: true,
    informational: true,
    normalization_allowed: true,
    reader_paths: [],
    writer_paths: [],
  },
  {
    key: FACTORY_LABEL_KEYS.QUARANTINED,
    name: "quarantined",
    description: "Temporarily quarantined after repeated review failures",
    color: "b60205",
    semantics: "quarantine_state",
    class: "lifecycle",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: [
      "packages/factory-ops/src/commands/supervisor-state-snapshot.ts",
    ],
    writer_paths: ["packages/factory-ops/src/commands/goal-run-state.ts"],
  },
  {
    key: FACTORY_LABEL_KEYS.DEFERRED,
    name: "deferred",
    description: "Deferred during triage until explicit unblock condition is met",
    color: "c2e0c6",
    semantics: "deferred_state",
    class: "workflow",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: ["packages/factory-ops/src/commands/triage-apply-terminal-status.ts"],
    writer_paths: ["packages/factory-ops/src/commands/triage-apply-terminal-status.ts"],
  },
  {
    key: FACTORY_LABEL_KEYS.FACTORY_TRACKING,
    name: "factory-tracking",
    description: "Factory infrastructure tracking issue (do not modify/close)",
    color: "5319e7",
    semantics: "factory_tracking",
    class: "operator",
    shared: true,
    informational: true,
    normalization_allowed: true,
    reader_paths: [],
    writer_paths: [],
  },
  {
    key: FACTORY_LABEL_KEYS.PROCESS,
    name: "process",
    description: "Process/workflow",
    color: "d4c5f9",
    semantics: "process_meta",
    class: "type",
    shared: true,
    informational: true,
    normalization_allowed: true,
    reader_paths: [],
    writer_paths: [],
  },
  {
    key: FACTORY_LABEL_KEYS.BLOCKED_CONTROL_PLANE,
    name: "blocked-control-plane",
    description: "Blocked on an upstream control-plane condition",
    color: "d93f0b",
    semantics: "control_plane_blocked",
    class: "lifecycle",
    shared: true,
    informational: false,
    normalization_allowed: false,
    reader_paths: [
      "packages/factory-ops/src/lib/control-plane-blocker.ts",
      "packages/factory-ops/src/commands/supervisor-blocker-review.ts",
    ],
    writer_paths: [],
  },
  {
    key: FACTORY_LABEL_KEYS.MERGE_FOLLOWUP,
    name: "merge-followup",
    description: "Deterministic tracking issue for merge conveyor failures",
    color: "FBCA04",
    semantics: "merge_followup",
    class: "workflow",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: ["packages/factory-ops/src/commands/supervisor-close-merge-followups.ts"],
    writer_paths: ["packages/factory-ops/src/commands/supervisor-state-snapshot.ts"],
  },
  {
    key: FACTORY_LABEL_KEYS.MANAGED_FACTORY_BUG,
    name: "managed-factory-bug",
    description: "Factory label: managed-factory-bug",
    color: "5319e7",
    semantics: "managed_factory_bug",
    class: "factory",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: [
      "packages/factory-ops/src/commands/supervisor-artifact.ts",
      "packages/factory-ops/src/commands/supervisor-upstream-bug-gate.ts",
    ],
    writer_paths: ["packages/factory-ops/src/commands/supervisor-artifact.ts"],
  },
  {
    key: FACTORY_LABEL_KEYS.INCIDENT_FINGERPRINT,
    name: "incident-fingerprint",
    description: "Factory label: incident-fingerprint",
    color: "5319e7",
    semantics: "incident_fingerprint",
    class: "factory",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: [
      "packages/factory-ops/src/commands/supervisor-artifact.ts",
    ],
    writer_paths: ["packages/factory-ops/src/commands/supervisor-artifact.ts"],
  },
  {
    key: FACTORY_LABEL_KEYS.HUMAN,
    name: "human",
    description: "auto-created",
    color: "ededed",
    semantics: "human_escalation",
    class: "operator",
    shared: true,
    informational: false,
    normalization_allowed: false,
    reader_paths: ["packages/factory-ops/src/commands/labels-normalize.ts"],
    writer_paths: [],
  },
  {
    key: FACTORY_LABEL_KEYS.AWAITING_HUMAN,
    name: "awaiting-human",
    description: "auto-created",
    color: "ededed",
    semantics: "human_wait",
    class: "operator",
    shared: true,
    informational: false,
    normalization_allowed: false,
    reader_paths: ["packages/factory-ops/src/commands/labels-normalize.ts"],
    writer_paths: [],
  },
  {
    key: FACTORY_LABEL_KEYS.BLOCKED,
    name: "blocked",
    description: "Blocked by dependencies or human input",
    color: "fbca04",
    semantics: "generic_blocked",
    class: "workflow",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: [
      "packages/factory-ops/src/commands/supervisor-normalize-feature-labels.ts",
    ],
    writer_paths: [],
  },
  {
    key: FACTORY_LABEL_KEYS.BRAINSTORM,
    name: "brainstorm",
    description: "Brainstorm intake issue",
    color: "1d76db",
    semantics: "brainstorm_type",
    class: "type",
    shared: true,
    informational: false,
    normalization_allowed: true,
    reader_paths: [
      "packages/factory-ops/src/cli/commands/brainstorm.ts",
      "packages/factory-ops/src/commands/brainstorm-next-issue.ts",
    ],
    writer_paths: [],
  },
]);

function buildKindOverlaySpec(key, kindId) {
  return Object.freeze({
    key, name: `kind:${kindId}`, description: `Managed factory kind label: ${kindId}`,
    color: "5319E7", semantics: "managed_factory_kind", class: "factory",
    shared: false, informational: true, normalization_allowed: true, reader_paths: [], writer_paths: [],
  });
}

const FACTORY_LABEL_OVERLAYS = Object.freeze({
  "example-scanner": Object.freeze([buildKindOverlaySpec(FACTORY_LABEL_KEYS.KIND_EXAMPLE_SCANNER, "example-scanner")]),
  brainstorm: Object.freeze([buildKindOverlaySpec(FACTORY_LABEL_KEYS.KIND_BRAINSTORM, "brainstorm")]),
  mothership: Object.freeze([buildKindOverlaySpec(FACTORY_LABEL_KEYS.KIND_MOTHERSHIP, "mothership")]),
  "example-trading": Object.freeze([
    Object.freeze({
      key: FACTORY_LABEL_KEYS.FACTORY_EXAMPLE_TRADING,
      name: "factory:example-trading",
      description: "Factory label: factory:example-trading",
      color: "5319e7",
      semantics: "factory_identity",
      class: "factory",
      shared: false,
      informational: false,
      normalization_allowed: true,
      reader_paths: [
        "packages/factory-ops/src/commands/supervisor-artifact.ts",
        "packages/factory-ops/src/commands/supervisor-upstream-bug-gate.ts",
      ],
      writer_paths: ["packages/factory-ops/src/commands/supervisor-artifact.ts"],
    }),
    buildKindOverlaySpec(FACTORY_LABEL_KEYS.KIND_EXAMPLE_TRADING, "example-trading"),
  ]),
  "example-web": Object.freeze([
    Object.freeze({
      key: FACTORY_LABEL_KEYS.FACTORY_EXAMPLE_WEB,
      name: "factory:example-web",
      description: "Factory label: factory:example-web",
      color: "5319e7",
      semantics: "factory_identity",
      class: "factory",
      shared: false,
      informational: false,
      normalization_allowed: true,
      reader_paths: [
        "packages/factory-ops/src/commands/supervisor-artifact.ts",
        "packages/factory-ops/src/commands/supervisor-upstream-bug-gate.ts",
      ],
      writer_paths: ["packages/factory-ops/src/commands/supervisor-artifact.ts"],
    }),
    buildKindOverlaySpec(FACTORY_LABEL_KEYS.KIND_EXAMPLE_WEB, "example-web"),
  ]),
});

const MANAGED_FACTORY_KIND_CONTRACTS = Object.freeze({
  "example-notes": Object.freeze({
    kind_id: "example-notes",
    target_repo: "example-org/example-notes",
    control_plane_repo: "recallnet/astrochicken",
    home_label_overrides: Object.freeze([]),
  }),
});

const MANAGED_FACTORY_HOME_BASELINE_LABEL_SPECS = Object.freeze([
  Object.freeze({
    name: "hatch:intake",
    description: "Managed factory intake item",
    color: "1D76DB",
    semantics: "managed_home_intake",
    class: "managed_home",
  }),
  Object.freeze({
    name: "hatch:queued",
    description: "Managed factory work queued for planning",
    color: "5319E7",
    semantics: "managed_home_queued",
    class: "managed_home",
  }),
  Object.freeze({
    name: "hatch:in-progress",
    description: "Managed factory work in progress",
    color: "FBCA04",
    semantics: "managed_home_in_progress",
    class: "managed_home",
  }),
  Object.freeze({
    name: "hatch:blocked",
    description: "Managed factory work blocked on dependency or policy",
    color: "D93F0B",
    semantics: "managed_home_blocked",
    class: "managed_home",
  }),
  Object.freeze({
    name: "hatch:done",
    description: "Managed factory work completed",
    color: "0E8A16",
    semantics: "managed_home_done",
    class: "managed_home",
  }),
]);

function normalizeManagedFactoryKindId(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    throw new Error("managed_factory_kind_required");
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
    throw new Error(`invalid_managed_factory_kind:${normalized}`);
  }
  return normalized;
}

function normalizeRepoIdentity(repo = "", { field = "repo" } = {}) {
  const normalized = String(repo || "").trim().toLowerCase();
  if (!normalized) {
    throw new Error(`missing_${field}`);
  }
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(normalized)) {
    throw new Error(`invalid_${field}:${repo}`);
  }
  return normalized;
}

function freezeManagedLabelSpec(spec, { scope = "" } = {}) {
  return Object.freeze({
    ...spec,
    scope,
  });
}

function buildManagedKindLabelSpec(kindId = "") {
  return Object.freeze({
    name: `kind:${kindId}`,
    description: `Managed factory kind label: ${kindId}`,
    color: "5319E7",
    semantics: "managed_factory_kind",
    class: "factory",
  });
}

function buildLabelCreateArgs(repo = "", spec = {}) {
  return [
    "label",
    "create",
    String(spec?.name || "").trim(),
    "--repo",
    repo,
    "--description",
    String(spec?.description || "").trim(),
    "--color",
    String(spec?.color || "").trim(),
    "--force",
  ];
}

export function listManagedFactoryKinds() {
  return Object.freeze(Object.keys(MANAGED_FACTORY_KIND_CONTRACTS).sort((left, right) => left.localeCompare(right, "en")));
}

export function resolveManagedFactoryKindContract(kindId = "") {
  const normalizedKindId = normalizeManagedFactoryKindId(kindId);
  const contract = MANAGED_FACTORY_KIND_CONTRACTS[normalizedKindId];
  if (!contract) {
    throw new Error(`unsupported_managed_factory_kind:${normalizedKindId}`);
  }
  return contract;
}

export function resolveManagedFactoryLabelSet({ kindId = "", targetRepo = "", controlPlaneRepo = "" } = {}) {
  const contract = resolveManagedFactoryKindContract(kindId);
  const resolvedTargetRepo = targetRepo
    ? normalizeRepoIdentity(targetRepo, { field: "target_repo" })
    : normalizeRepoIdentity(contract.target_repo, { field: "target_repo" });
  const resolvedControlPlaneRepo = controlPlaneRepo
    ? normalizeRepoIdentity(controlPlaneRepo, { field: "control_plane_repo" })
    : normalizeRepoIdentity(contract.control_plane_repo, { field: "control_plane_repo" });

  if (resolvedTargetRepo !== normalizeRepoIdentity(contract.target_repo, { field: "target_repo" })) {
    throw new Error(`target_repo_boundary_mismatch:expected=${contract.target_repo}:actual=${resolvedTargetRepo}`);
  }
  if (resolvedControlPlaneRepo !== normalizeRepoIdentity(contract.control_plane_repo, { field: "control_plane_repo" })) {
    throw new Error(`control_plane_repo_boundary_mismatch:expected=${contract.control_plane_repo}:actual=${resolvedControlPlaneRepo}`);
  }

  const managedFactoryBug = getFactoryLabelSpecByName("mothership", "managed-factory-bug");
  if (!managedFactoryBug) {
    throw new Error("managed_factory_bug_label_missing_from_core_contract");
  }

  const controlPlaneLabels = [
    freezeManagedLabelSpec({
      name: managedFactoryBug.name,
      description: managedFactoryBug.description,
      color: managedFactoryBug.color,
      semantics: managedFactoryBug.semantics,
      class: managedFactoryBug.class,
    }, { scope: "control_plane" }),
    freezeManagedLabelSpec(buildManagedKindLabelSpec(contract.kind_id), { scope: "control_plane" }),
  ];

  const homeLabels = [
    ...MANAGED_FACTORY_HOME_BASELINE_LABEL_SPECS,
    ...(Array.isArray(contract.home_label_overrides) ? contract.home_label_overrides : []),
  ].map((spec) => freezeManagedLabelSpec(spec, { scope: "home" }));

  return Object.freeze({
    kind_id: contract.kind_id,
    target_repo: resolvedTargetRepo,
    control_plane_repo: resolvedControlPlaneRepo,
    control_plane_labels: Object.freeze(controlPlaneLabels),
    home_labels: Object.freeze(homeLabels),
  });
}

export function buildManagedFactoryLabelSnapshot() {
  return {
    schema_version: "managed_factory_label_contract/v1",
    kinds: listManagedFactoryKinds().map((kindId) => {
      const labelSet = resolveManagedFactoryLabelSet({ kindId });
      return {
        kind_id: labelSet.kind_id,
        target_repo: labelSet.target_repo,
        control_plane_repo: labelSet.control_plane_repo,
        control_plane_labels: labelSet.control_plane_labels,
        home_labels: labelSet.home_labels,
      };
    }),
  };
}

export function buildManagedFactoryLabelProvisionPlan({ kindId = "", targetRepo = "", controlPlaneRepo = "" } = {}) {
  const labelSet = resolveManagedFactoryLabelSet({ kindId, targetRepo, controlPlaneRepo });
  const controlPlanePlan = labelSet.control_plane_labels.map((spec) => ({
    scope: "control_plane",
    repo: labelSet.control_plane_repo,
    label: spec.name,
    args: buildLabelCreateArgs(labelSet.control_plane_repo, spec),
  }));
  const homePlan = labelSet.home_labels.map((spec) => ({
    scope: "home",
    repo: labelSet.target_repo,
    label: spec.name,
    args: buildLabelCreateArgs(labelSet.target_repo, spec),
  }));

  return {
    kind_id: labelSet.kind_id,
    target_repo: labelSet.target_repo,
    control_plane_repo: labelSet.control_plane_repo,
    operations: [...controlPlanePlan, ...homePlan],
  };
}

export function provisionManagedFactoryLabels({
  kindId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  dryRun = false,
  ghExec,
  authCheck,
} = {}) {
  const executor = typeof ghExec === "function"
    ? ghExec
    : gh;
  const checkAuth = typeof authCheck === "function"
    ? authCheck
    : (exec) => exec(["auth", "status"]);

  const plan = buildManagedFactoryLabelProvisionPlan({ kindId, targetRepo, controlPlaneRepo });

  let authResult;
  try {
    authResult = checkAuth(executor);
  } catch (error) {
    authResult = { ok: false, status: 1, stderr: String(error?.message || error || "auth_check_failed") };
  }

  const authStatus = authResult?.status ?? (authResult?.ok ? 0 : 1);
  if (authStatus !== 0) {
    return {
      ok: false,
      dry_run: Boolean(dryRun),
      kind_id: plan.kind_id,
      target_repo: plan.target_repo,
      control_plane_repo: plan.control_plane_repo,
      operations: [],
      error: "missing_github_auth",
      auth_stderr: String(authResult?.stderr || authResult?.stdout || "gh auth status failed"),
    };
  }

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      kind_id: plan.kind_id,
      target_repo: plan.target_repo,
      control_plane_repo: plan.control_plane_repo,
      operations: plan.operations.map((operation) => ({
        ...operation,
        ok: true,
        status: 0,
        stdout: "",
        stderr: "",
      })),
      error: "",
    };
  }

  const operations = plan.operations.map((operation) => {
    const result = executor(operation.args);
    return {
      ...operation,
      ok: result?.status === 0 || result?.ok === true,
      status: result?.status ?? (result?.ok ? 0 : 1),
      stdout: String(result?.stdout || ""),
      stderr: String(result?.stderr || ""),
    };
  });

  const ok = operations.every((operation) => operation.ok);
  return {
    ok,
    dry_run: false,
    kind_id: plan.kind_id,
    target_repo: plan.target_repo,
    control_plane_repo: plan.control_plane_repo,
    operations,
    error: ok ? "" : "label_provision_failed",
  };
}

function freezeSpec(spec, { source = "core", factoryId = "" } = {}) {
  return Object.freeze({
    ...spec,
    source,
    factory_id: factoryId,
    reader_paths: Object.freeze([...(spec.reader_paths || [])]),
    writer_paths: Object.freeze([...(spec.writer_paths || [])]),
  });
}

export function listCoreFactoryLabelSpecs() {
  return CORE_FACTORY_LABEL_SPECS.map((spec) => freezeSpec(spec));
}

export function listFactoryOverlaySpecs(factoryId = "") {
  const normalizedFactoryId = String(factoryId || "").trim();
  const overlay = FACTORY_LABEL_OVERLAYS[normalizedFactoryId] || [];
  return overlay.map((spec) => freezeSpec(spec, { source: "overlay", factoryId: normalizedFactoryId }));
}

export function resolveFactoryLabelContract(factoryId = "mothership") {
  const normalizedFactoryId = String(factoryId || "mothership").trim() || "mothership";
  const specs = [...listCoreFactoryLabelSpecs(), ...listFactoryOverlaySpecs(normalizedFactoryId)];
  const byKey = new Map();
  const byName = new Map();

  for (const spec of specs) {
    if (!spec.key || !spec.name) {
      throw new Error(`Factory label spec missing key/name for factory '${normalizedFactoryId}'`);
    }
    if (byKey.has(spec.key)) {
      throw new Error(`Duplicate factory label key '${spec.key}' for factory '${normalizedFactoryId}'`);
    }
    if (byName.has(spec.name)) {
      throw new Error(`Duplicate factory label name '${spec.name}' for factory '${normalizedFactoryId}'`);
    }
    byKey.set(spec.key, spec);
    byName.set(spec.name, spec);
  }

  return Object.freeze({
    factory_id: normalizedFactoryId,
    labels: Object.freeze(specs),
    by_key: byKey,
    by_name: byName,
  });
}

export function listFactoryIdsWithLabelOverlays() {
  return Object.freeze(Object.keys(FACTORY_LABEL_OVERLAYS).sort((left, right) => left.localeCompare(right, "en")));
}

export function getFactoryLabelSpec(factoryId = "mothership", key = "") {
  return resolveFactoryLabelContract(factoryId).by_key.get(String(key || "").trim()) || null;
}

export function getFactoryLabelSpecByName(factoryId = "mothership", labelName = "") {
  return resolveFactoryLabelContract(factoryId).by_name.get(String(labelName || "").trim()) || null;
}

export function getFactoryLabelName(factoryId = "mothership", key = "") {
  return getFactoryLabelSpec(factoryId, key)?.name || "";
}

export function getFactoryLabelNames(factoryId = "mothership", keys = []) {
  return (Array.isArray(keys) ? keys : []).map((key) => getFactoryLabelName(factoryId, key)).filter(Boolean);
}

export function getDefaultNormalizationLabelNames(factoryId = "mothership") {
  return resolveFactoryLabelContract(factoryId).labels
    .filter((spec) => spec.normalization_allowed !== false)
    .map((spec) => spec.name);
}

export function ensureKnownFactoryLabelKeys(factoryId = "mothership", keys = []) {
  for (const key of Array.isArray(keys) ? keys : []) {
    if (!getFactoryLabelSpec(factoryId, key)) {
      throw new Error(`Unknown factory label key '${key}' for factory '${factoryId}'`);
    }
  }
}

export function validateFactoryLabelContract(factoryId = "mothership") {
  const contract = resolveFactoryLabelContract(factoryId);
  const errors = [];

  for (const spec of contract.labels) {
    if (!/^[a-z0-9:/_-]+$/i.test(spec.name)) {
      errors.push(`invalid_label_name:${spec.name}`);
    }
    if (!/^[0-9a-fA-F]{6}$/.test(spec.color || "")) {
      errors.push(`invalid_label_color:${spec.key}`);
    }
    if (!spec.description) {
      errors.push(`missing_label_description:${spec.key}`);
    }
    if (!spec.informational) {
      if (!Array.isArray(spec.reader_paths) || spec.reader_paths.length === 0) {
        errors.push(`missing_label_readers:${spec.key}`);
      }
      if (!Array.isArray(spec.writer_paths)) {
        errors.push(`missing_label_writers:${spec.key}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    factory_id: factoryId,
    label_count: contract.labels.length,
    errors,
  };
}

export function buildFactoryLabelSnapshot() {
  return {
    schema_version: "factory_label_contract/v1",
    factories: listFactoryIdsWithLabelOverlays().map((factoryId) => ({
      factory_id: factoryId,
      labels: resolveFactoryLabelContract(factoryId).labels.map((spec) => ({
        key: spec.key,
        name: spec.name,
        description: spec.description,
        color: spec.color,
        semantics: spec.semantics,
        class: spec.class,
        shared: spec.shared,
        informational: spec.informational,
        normalization_allowed: spec.normalization_allowed !== false,
        source: spec.source,
      })),
    })),
    managed_factory_labels: buildManagedFactoryLabelSnapshot(),
  };
}

export function issueHasFactoryLabel(issue, { factoryId = "mothership", key = "" } = {}) {
  const labelName = getFactoryLabelName(factoryId, key);
  if (!labelName) return false;
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  return labels.some((label) => String(label?.name || label || "").trim() === labelName);
}

export function buildEnsureLabelArgs({ repo = "", factoryId = "mothership", keys = [] } = {}) {
  if (!repo) throw new Error("repo is required");
  ensureKnownFactoryLabelKeys(factoryId, keys);
  return getFactoryLabelNames(factoryId, keys).map((labelName) => {
    const spec = getFactoryLabelSpecByName(factoryId, labelName);
    return [
      "label",
      "create",
      spec.name,
      "--repo",
      repo,
      "--description",
      spec.description,
      "--color",
      spec.color,
      "--force",
    ];
  });
}

export function ensureFactoryLabels({ repo = "", factoryId = "mothership", keys = [], ghExec } = {}) {
  const executor = typeof ghExec === "function"
    ? ghExec
    : gh;
  const commands = buildEnsureLabelArgs({ repo, factoryId, keys });
  const results = [];
  for (const args of commands) {
    const result = executor(args);
    results.push({
      args,
      ok: result?.status === 0 || result?.ok === true,
      status: result?.status ?? (result?.ok ? 0 : 1),
      stdout: String(result?.stdout || ""),
      stderr: String(result?.stderr || ""),
    });
  }
  return {
    ok: results.every((entry) => entry.ok),
    repo,
    factory_id: factoryId,
    keys: [...keys],
    ensured_labels: getFactoryLabelNames(factoryId, keys),
    results,
  };
}

export function buildIssueLabelEditArgs({ repo = "", issueNumber = "", factoryId = "mothership", addKeys = [], removeKeys = [] } = {}) {
  if (!repo) throw new Error("repo is required");
  if (!issueNumber) throw new Error("issueNumber is required");
  ensureKnownFactoryLabelKeys(factoryId, addKeys);
  ensureKnownFactoryLabelKeys(factoryId, removeKeys);
  return [
    "issue",
    "edit",
    String(issueNumber),
    "--repo",
    repo,
    ...getFactoryLabelNames(factoryId, addKeys).flatMap((label) => ["--add-label", label]),
    ...getFactoryLabelNames(factoryId, removeKeys).flatMap((label) => ["--remove-label", label]),
  ];
}

export function validateFactoryRepoLabels({ repo = "", factoryId = "mothership", ghJsonExec } = {}) {
  if (!repo) {
    return {
      ok: false,
      repo: "",
      factory_id: factoryId,
      missing: [],
      mismatched: [],
      error: "missing_repo",
    };
  }

  const execJson = typeof ghJsonExec === "function"
    ? ghJsonExec
    : (args) => ghJson(args, []);

  const contract = resolveFactoryLabelContract(factoryId);
  let repoLabels = [];
  try {
    repoLabels = execJson(["label", "list", "--repo", repo, "--limit", "200", "--json", "name,description,color"]);
  } catch (error) {
    return {
      ok: false,
      repo,
      factory_id: factoryId,
      missing: [],
      mismatched: [],
      error: String(error?.message || error || "repo_label_validation_failed"),
    };
  }

  const byName = new Map((Array.isArray(repoLabels) ? repoLabels : []).map((label) => [String(label?.name || "").trim(), label]));
  const missing = [];
  const mismatched = [];
  for (const spec of contract.labels) {
    const existing = byName.get(spec.name);
    if (!existing) {
      missing.push(spec.name);
      continue;
    }
    const description = String(existing?.description || "");
    const color = String(existing?.color || "");
    if (description !== spec.description || color.toLowerCase() !== String(spec.color || "").toLowerCase()) {
      mismatched.push({
        name: spec.name,
        expected: { description: spec.description, color: spec.color },
        actual: { description, color },
      });
    }
  }

  return {
    ok: missing.length === 0 && mismatched.length === 0,
    repo,
    factory_id: factoryId,
    missing,
    mismatched,
    error: "",
  };
}
