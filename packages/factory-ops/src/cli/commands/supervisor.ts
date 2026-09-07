import { Command, Option } from "clipanion";

// Backend resolver wiring seam: tests and future CLI bootstrap can inject
// backend-aware query deps through `command.supervisorQueryDeps`.
function resolveSupervisorQueryDeps(command) {
  const injected = command && typeof command === "object" ? command.supervisorQueryDeps : null;
  if (!injected || typeof injected !== "object") {
    return {};
  }

  return {
    ghJsonFn: typeof injected.ghJsonFn === "function" ? injected.ghJsonFn : undefined,
    backendAdapter: injected.backendAdapter && typeof injected.backendAdapter === "object"
      ? injected.backendAdapter
      : undefined,
  };
}

export class SupervisorStatusCommand extends Command {
  static paths = [["supervisor", "status"]];
  repo = Option.String("--repo", "");

  async execute() {
    const { getSupervisorStatus } = await import("../../commands/supervisor-status.ts");
    this.context.stdout.write(JSON.stringify(getSupervisorStatus({ repo: this.repo })));
    return 0;
  }
}

export class SupervisorHealthCheckCommand extends Command {
  static paths = [["supervisor", "health-check"]];
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "");
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "factory_supervisor_tick");

  async execute() {
    const { checkSupervisorHealth } = await import("../../commands/supervisor-health-check.ts");
    const out = checkSupervisorHealth({
      repo: this.repo,
      factoryId: this.factoryId,
      runsDir: this.runsDir,
      runId: this.runId,
      pipeline: this.pipeline,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorValidateMainBranchCommand extends Command {
  static paths = [["supervisor", "validate-main-branch"]];
  repo = Option.String("--repo", "");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "factory_supervisor_tick");

  async execute() {
    const { validateMainBranchHealth } = await import("../../commands/supervisor-validate-main-branch.ts");
    const out = validateMainBranchHealth({ repo: this.repo, runId: this.runId, pipeline: this.pipeline });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorRemediateOrphanFeaturesCommand extends Command {
  static paths = [["supervisor", "remediate-orphan-features"]];
  repo = Option.String("--repo", "");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "factory_supervisor_tick");
  dryRun = Option.Boolean("--dry-run", false);

  async execute() {
    const { remediateOrphanFeatures } = await import("../../commands/supervisor-remediate-orphan-features.ts");
    const out = remediateOrphanFeatures({ repo: this.repo, runId: this.runId, pipeline: this.pipeline, dryRun: this.dryRun });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorFixOrphanFeaturesCommand extends Command {
  static paths = [["supervisor", "fix-orphan-features"], ["supervisor", "detect-orphan-features"]];
  repo = Option.String("--repo", "");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "factory_supervisor_tick");

  async execute() {
    const { fixOrphanFeatures } = await import("../../commands/supervisor-detect-orphan-features.ts");
    const out = fixOrphanFeatures({ repo: this.repo, runId: this.runId, pipeline: this.pipeline });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorStateSnapshotCommand extends Command {
  static paths = [["supervisor", "state-snapshot"]];
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  runsDir = Option.String("--runs-dir", "");
  registryPath = Option.String("--registry-path", "");
  policyPath = Option.String("--policy-path", "");
  policyJson = Option.String("--policy-json", "");
  manifestPath = Option.String("--manifest-path", "");
  manifestRef = Option.String("--manifest-ref", "");
  manifestFetchCmd = Option.String("--manifest-fetch-cmd", "");
  skipRecoverySweep = Option.Boolean("--skip-recovery-sweep", false);

  async execute() {
    const { buildStateSnapshot } = await import("../../commands/supervisor-state-snapshot.ts");
    const queryDeps = resolveSupervisorQueryDeps(this);
    const out = buildStateSnapshot({
      repo: this.repo,
      factoryId: this.factoryId,
      factoryRoot: this.factoryRoot,
      factoryConfigPath: this.factoryConfigPath,
      targetRepo: this.targetRepo,
      controlPlaneRepo: this.controlPlaneRepo,
      runsDir: this.runsDir,
      registryPath: this.registryPath,
      policyPath: this.policyPath,
      policyJson: this.policyJson,
      manifestPath: this.manifestPath,
      manifestRef: this.manifestRef,
      manifestFetchCmd: this.manifestFetchCmd,
      skipRecoverySweep: this.skipRecoverySweep,
      ...queryDeps,
    });
    this.context.stdout.write(out);
    return 0;
  }
}

export class SupervisorOpenBugGateCommand extends Command {
  static paths = [["supervisor", "open-bug-gate"]];
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  // Legacy repeatable label filter (kept for compatibility).
  labels = Option.Array("--label", []);
  // Explicit repeatable bug-label filter alias.
  bugLabels = Option.Array("--bug-label", []);
  snapshotJson = Option.String("--snapshot-json", "");
  snapshotFile = Option.String("--snapshot-file", "");

  async execute() {
    const { evaluateOpenBugGate } = await import("../../commands/supervisor-state-snapshot.ts");
    const parseFailure = (message) => ({
      has_open_bugs: "false",
      open_upstream_bugs: "false",
      open_bug_count: 0,
      issue_numbers: [],
      parse_error: String(message || "invalid_snapshot_override"),
    });

    const expandLabels = (values = []) => {
      const out = [];
      for (const raw of (Array.isArray(values) ? values : [])) {
        const value = String(raw || "").trim();
        if (!value) continue;
        if (value.startsWith("[") && value.endsWith("]")) {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                const normalized = String(item || "").trim();
                if (normalized) out.push(normalized);
              }
              continue;
            }
          } catch {
            // fall through to comma-split/string handling
          }
        }
        if (value.includes(",")) {
          for (const item of value.split(",")) {
            const normalized = String(item || "").trim();
            if (normalized) out.push(normalized);
          }
          continue;
        }
        out.push(value);
      }
      return Array.from(new Set(out));
    };

    const labelFilters = expandLabels([...(this.labels || []), ...(this.bugLabels || [])]);

    const rawSnapshotJson = String(this.snapshotJson || "").trim();
    const rawSnapshotFile = String(this.snapshotFile || "").trim();

    if (rawSnapshotJson) {
      try {
        const snapshotOverride = JSON.parse(rawSnapshotJson);
        const out = evaluateOpenBugGate({ snapshotOverride, labelFilters });
        this.context.stdout.write(JSON.stringify(out));
        return 0;
      } catch (error) {
        this.context.stdout.write(JSON.stringify(parseFailure(String(error?.message || error || "invalid_snapshot_json"))));
        return 0;
      }
    }

    if (rawSnapshotFile) {
      try {
        const { readFileSync } = await import("node:fs");
        const fileRaw = readFileSync(rawSnapshotFile, "utf8");
        const snapshotOverride = JSON.parse(String(fileRaw || ""));
        const out = evaluateOpenBugGate({ snapshotOverride, labelFilters });
        this.context.stdout.write(JSON.stringify(out));
        return 0;
      } catch (error) {
        this.context.stdout.write(JSON.stringify(parseFailure(String(error?.message || error || "invalid_snapshot_file"))));
        return 0;
      }
    }

    const out = evaluateOpenBugGate({
      repo: this.repo,
      controlPlaneRepo: this.controlPlaneRepo,
      labelFilters,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorUpstreamBugGateCommand extends Command {
  static paths = [["supervisor", "upstream-bug-gate"]];
  repo = Option.String("--repo", "");
  labels = Option.Array("--label", []);

  async execute() {
    const { evaluateUpstreamBugGate } = await import("../../commands/supervisor-upstream-bug-gate.ts");
    const queryDeps = resolveSupervisorQueryDeps(this);

    const expandLabels = (values = []) => {
      const out = [];
      for (const raw of (Array.isArray(values) ? values : [])) {
        const value = String(raw || "").trim();
        if (!value) continue;
        if (value.startsWith("[") && value.endsWith("]")) {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                const normalized = String(item || "").trim();
                if (normalized) out.push(normalized);
              }
              continue;
            }
          } catch {
            // fall through
          }
        }
        if (value.includes(",")) {
          for (const item of value.split(",")) {
            const normalized = String(item || "").trim();
            if (normalized) out.push(normalized);
          }
          continue;
        }
        out.push(value);
      }
      return Array.from(new Set(out));
    };

    const out = evaluateUpstreamBugGate({
      repo: this.repo,
      labelFilters: expandLabels(this.labels),
      ...queryDeps,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorManagedLoadContextCommand extends Command {
  static paths = [["supervisor", "managed-load-context"]];
  factoryId = Option.String("--factory-id", "");
  factoryRoot = Option.String("--factory-root", "");
  kindPath = Option.String("--kind-path", "");
  instancePath = Option.String("--instance-path", "");
  kindId = Option.String("--kind-id", "");
  instanceId = Option.String("--instance-id", "");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  destinationsJson = Option.String("--destinations-json", "");
  trustDomain = Option.String("--trust-domain", "");
  trustRole = Option.String("--trust-role", "");
  rootDir = Option.String("--root-dir", process.cwd());

  async execute() {
    const { loadManagedSupervisorContext } = await import("../../commands/supervisor-managed-load-context.ts");
    const out = loadManagedSupervisorContext({
      factoryId: this.factoryId,
      factoryRoot: this.factoryRoot,
      kindPath: this.kindPath,
      instancePath: this.instancePath,
      kindId: this.kindId,
      instanceId: this.instanceId,
      targetRepo: this.targetRepo,
      controlPlaneRepo: this.controlPlaneRepo,
      destinationsJson: this.destinationsJson,
      trustDomain: this.trustDomain,
      trustRole: this.trustRole,
      rootDir: this.rootDir,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorManagedControlGateCommand extends Command {
  static paths = [["supervisor", "managed-control-gate"]];
  stateAction = Option.String("--state-action", "");
  reason = Option.String("--reason", "");
  factoryId = Option.String("--factory-id", "");
  rootDir = Option.String("--root-dir", process.cwd());

  async execute() {
    const { evaluateManagedControlStateGate } = await import("../../commands/supervisor-managed-control-gate.ts");
    const out = evaluateManagedControlStateGate({
      stateAction: this.stateAction,
      reason: this.reason,
      factoryId: this.factoryId,
      rootDir: this.rootDir,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorManagedActionItemGateCommand extends Command {
  static paths = [["supervisor", "managed-action-item-gate"]];
  snapshot = Option.String("--snapshot", "");
  snapshotB64 = Option.String("--snapshot-b64", "");

  async execute() {
    const { evaluateManagedActionItemGate } = await import("../../commands/supervisor-managed-action-item-gate.ts");
    const out = evaluateManagedActionItemGate({
      snapshot: this.snapshot,
      snapshotB64: this.snapshotB64,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorManagedIntakeSelectorCommand extends Command {
  static paths = [["supervisor", "managed-intake-selector"]];
  repo = Option.String("--repo", "");
  intakeJson = Option.String("--intake-json", "");
  labels = Option.Array("--label", []);

  async execute() {
    const { selectManagedIntakeIssue } = await import("../../commands/supervisor-managed-intake-selector.ts");
    const queryDeps = resolveSupervisorQueryDeps(this);
    const out = selectManagedIntakeIssue({
      repo: this.repo,
      intakeJson: this.intakeJson,
      labels: this.labels,
      ...queryDeps,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorManagedHealthClassifierCommand extends Command {
  static paths = [["supervisor", "managed-health-classifier"]];
  controlGate = Option.String("--control-gate", "run");
  hasOpenUpstreamBugs = Option.String("--has-open-upstream-bugs", "false");
  hasActionItems = Option.String("--has-action-items", "false");
  hasSelectedWork = Option.String("--has-selected-work", "false");
  hasDomainFailure = Option.String("--has-domain-failure", "false");

  async execute() {
    const { classifyManagedLifecycleState } = await import("../../commands/supervisor-managed-health-classifier.ts");
    const out = classifyManagedLifecycleState({
      controlGate: this.controlGate,
      hasOpenUpstreamBugs: this.hasOpenUpstreamBugs,
      hasActionItems: this.hasActionItems,
      hasSelectedWork: this.hasSelectedWork,
      hasDomainFailure: this.hasDomainFailure,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorManagedFailureClassifierCommand extends Command {
  static paths = [["supervisor", "managed-failure-classifier"]];
  domainError = Option.String("--domain-error", "");
  parseError = Option.String("--parse-error", "");
  gate = Option.String("--gate", "");

  async execute() {
    const { classifyManagedFailure } = await import("../../commands/supervisor-managed-failure-classifier.ts");
    const out = classifyManagedFailure({
      domainError: this.domainError,
      parseError: this.parseError,
      gate: this.gate,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorManagedEmitRunSummaryCommand extends Command {
  static paths = [["supervisor", "managed-emit-run-summary"]];
  factoryId = Option.String("--factory-id", "");
  instanceId = Option.String("--instance-id", "");
  kindId = Option.String("--kind-id", "");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  trustDomain = Option.String("--trust-domain", "");
  trustRole = Option.String("--trust-role", "");
  lifecycleState = Option.String("--lifecycle-state", "idle");
  healthState = Option.String("--health-state", "idle");
  failureClassification = Option.String("--failure-classification", "none");
  failureReason = Option.String("--failure-reason", "");
  controlGate = Option.String("--control-gate", "run");
  controlStateAction = Option.String("--control-state-action", "none");
  controlStateReason = Option.String("--control-state-reason", "");
  hasOpenUpstreamBugs = Option.String("--has-open-upstream-bugs", "false");
  openUpstreamBugCount = Option.String("--open-upstream-bug-count", "0");
  openUpstreamBugNumbers = Option.String("--open-upstream-bug-numbers", "[]");
  hasActionItems = Option.String("--has-action-items", "false");
  actionItemCount = Option.String("--action-item-count", "0");
  unresolvedActions = Option.String("--unresolved-actions", "");
  queueDepth = Option.String("--queue-depth", "0");
  oldestWorkAgeSeconds = Option.String("--oldest-work-age-seconds", "0");
  latestIncidents = Option.String("--latest-incidents", "[]");
  hasIssue = Option.String("--has-issue", "false");
  selectedIssueNumber = Option.String("--selected-issue-number", "");
  domainResult = Option.String("--domain-result", "");
  manifestOk = Option.String("--manifest-ok", "true");
  manifestError = Option.String("--manifest-error", "");
  parseError = Option.String("--parse-error", "");

  async execute() {
    const { emitManagedRunSummary } = await import("../../commands/supervisor-managed-emit-run-summary.ts");
    const out = emitManagedRunSummary({
      factoryId: this.factoryId,
      instanceId: this.instanceId,
      kindId: this.kindId,
      targetRepo: this.targetRepo,
      controlPlaneRepo: this.controlPlaneRepo,
      trustDomain: this.trustDomain,
      trustRole: this.trustRole,
      lifecycleState: this.lifecycleState,
      healthState: this.healthState,
      failureClassification: this.failureClassification,
      failureReason: this.failureReason,
      controlGate: this.controlGate,
      controlStateAction: this.controlStateAction,
      controlStateReason: this.controlStateReason,
      hasOpenUpstreamBugs: this.hasOpenUpstreamBugs,
      openUpstreamBugCount: this.openUpstreamBugCount,
      openUpstreamBugNumbers: this.openUpstreamBugNumbers,
      hasActionItems: this.hasActionItems,
      actionItemCount: this.actionItemCount,
      unresolvedActions: this.unresolvedActions,
      queueDepth: this.queueDepth,
      oldestWorkAgeSeconds: this.oldestWorkAgeSeconds,
      latestIncidents: this.latestIncidents,
      hasIssue: this.hasIssue,
      selectedIssueNumber: this.selectedIssueNumber,
      domainResult: this.domainResult,
      manifestOk: this.manifestOk,
      manifestError: this.manifestError,
      parseError: this.parseError,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorManagedPersistStateCommand extends Command {
  static paths = [["supervisor", "managed-persist-state"]];
  factoryId = Option.String("--factory-id", "");
  instanceId = Option.String("--instance-id", "");
  rootDir = Option.String("--root-dir", process.cwd());
  lifecycleState = Option.String("--lifecycle-state", "");
  lifecycleReason = Option.String("--lifecycle-reason", "");
  failureClassification = Option.String("--failure-classification", "");
  failureReason = Option.String("--failure-reason", "");
  hasOpenUpstreamBugs = Option.String("--has-open-upstream-bugs", "false");
  openUpstreamBugCount = Option.String("--open-upstream-bug-count", "0");
  openUpstreamBugNumbers = Option.String("--open-upstream-bug-numbers", "[]");
  hasActionItems = Option.String("--has-action-items", "false");
  actionItemCount = Option.String("--action-item-count", "0");
  unresolvedActions = Option.String("--unresolved-actions", "");
  queueDepth = Option.String("--queue-depth", "0");
  oldestWorkAgeSeconds = Option.String("--oldest-work-age-seconds", "0");
  latestIncidents = Option.String("--latest-incidents", "[]");
  actor = Option.String("--actor", "managed_supervisor");

  async execute() {
    const { persistManagedLifecycleState } = await import("../../commands/supervisor-managed-persist-state.ts");
    const out = persistManagedLifecycleState({
      factoryId: this.factoryId,
      instanceId: this.instanceId,
      rootDir: this.rootDir,
      lifecycleState: this.lifecycleState,
      lifecycleReason: this.lifecycleReason,
      failureClassification: this.failureClassification,
      failureReason: this.failureReason,
      hasOpenUpstreamBugs: this.hasOpenUpstreamBugs,
      openUpstreamBugCount: this.openUpstreamBugCount,
      openUpstreamBugNumbers: this.openUpstreamBugNumbers,
      hasActionItems: this.hasActionItems,
      actionItemCount: this.actionItemCount,
      unresolvedActions: this.unresolvedActions,
      queueDepth: this.queueDepth,
      oldestWorkAgeSeconds: this.oldestWorkAgeSeconds,
      latestIncidents: this.latestIncidents,
      actor: this.actor,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class SupervisorManagedDomainContractCommand extends Command {
  static paths = [["supervisor", "managed-domain-contract"]];
  dotPath = Option.String("--dot-path", "");

  async execute() {
    const { validateManagedDomainContract } = await import("../../commands/supervisor-managed-domain-contract.ts");
    const out = validateManagedDomainContract({
      dotPath: this.dotPath,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}


export class SupervisorEmitBugCommand extends Command {
  static paths = [["supervisor", "emit-bug"]];
  repo = Option.String("--repo", "");
  bugType = Option.String("--bug-type", "");
  summary = Option.String("--summary", "");
  evidenceJson = Option.String("--evidence-json", { required: false });
  evidenceB64 = Option.String("--evidence-b64", { required: false });
  labels = Option.Array("--label", []);
  labelsAlias = Option.Array("--labels", []);
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "");
  signatureHash = Option.String("--signature-hash", "");
  factoryId = Option.String("--factory-id", "");
  sourceFactory = Option.String("--source-factory", "");
  sourceRepo = Option.String("--source-repo", "");
  classification = Option.String("--classification", "");
  severity = Option.String("--severity", "");
  crashType = Option.String("--crash-type", "");
  runtimeVersion = Option.String("--runtime-version", "");
  kindVersion = Option.String("--kind-version", "");
  kindId = Option.String("--kind-id", "");
  instanceId = Option.String("--instance-id", "");
  hostId = Option.String("--host-id", "");
  fingerprint = Option.String("--fingerprint", "");
  mutationContextJson = Option.String("--mutation-context-json", "");
  needsReviewQueuePath = Option.String("--needs-review-queue-path", "");

  async execute() {
    const { resolveJsonPayload } = await import("../helpers.ts");
    const { emitBugIssue } = await import("../../commands/supervisor-artifact.ts");

    let evidenceRaw = "";
    try {
      evidenceRaw = await resolveJsonPayload({
        flag: this.evidenceJson,
        flagB64: this.evidenceB64,
        flagName: "evidence",
        allowStdin: false,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }

    let evidence = {};
    try {
      evidence = evidenceRaw ? JSON.parse(String(evidenceRaw)) : {};
    } catch {
      evidence = { raw: String(evidenceRaw || "") };
    }

    const parsedLabels = Array.from(new Set([
      ...(Array.isArray(this.labels) ? this.labels : []),
      ...(Array.isArray(this.labelsAlias) ? this.labelsAlias : []),
    ]
      .map((label) => String(label || "").trim())
      .filter(Boolean)));

    let mutationContext = {};
    try {
      mutationContext = this.mutationContextJson
        ? JSON.parse(String(this.mutationContextJson || ""))
        : {};
    } catch {
      mutationContext = { raw: String(this.mutationContextJson || "") };
    }

    const out = emitBugIssue({
      repo: this.repo,
      bugType: this.bugType,
      summary: this.summary,
      evidence,
      labels: parsedLabels,
      runId: this.runId,
      pipeline: this.pipeline,
      signatureHash: this.signatureHash,
      factoryId: this.factoryId,
      sourceFactory: this.sourceFactory,
      sourceRepo: this.sourceRepo,
      classification: this.classification,
      severity: this.severity,
      crashType: this.crashType,
      runtimeVersion: this.runtimeVersion,
      kindVersion: this.kindVersion,
      kindId: this.kindId,
      instanceId: this.instanceId,
      hostId: this.hostId,
      fingerprint: this.fingerprint,
      mutationContext,
      needsReviewQueuePath: this.needsReviewQueuePath,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class SupervisorEnsureHumanBlockerCommand extends Command {
  static paths = [["supervisor", "ensure-human-blocker"]];
  repo = Option.String("--repo", "");
  issue = Option.String("--issue", "");
  goalIssue = Option.String("--goal-issue", "");
  milestone = Option.String("--milestone", "");
  blockedBy = Option.String("--blocked-by", "[]");
  humanBlockerJson = Option.String("--human-blocker-json", { required: false });
  humanBlockerB64 = Option.String("--human-blocker-b64", { required: false });
  factoryId = Option.String("--factory-id", "");
  sourceRepo = Option.String("--source-repo", "");

  async execute() {
    const { resolveJsonPayload } = await import("../helpers.ts");
    const { ensureHumanBlockerIssue } = await import("../../commands/human-blocker.ts");

    let humanBlockerRaw = "";
    try {
      humanBlockerRaw = await resolveJsonPayload({
        flag: this.humanBlockerJson,
        flagB64: this.humanBlockerB64,
        flagName: "human-blocker",
        allowStdin: false,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }

    const out = ensureHumanBlockerIssue({
      repo: this.repo,
      issueNumber: this.issue,
      goalIssueNumber: this.goalIssue,
      milestoneTitle: this.milestone,
      humanBlockerRaw,
      blockedByRaw: this.blockedBy,
      factoryId: this.factoryId,
      sourceRepo: this.sourceRepo,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class SupervisorActionItemGateCommand extends Command {
  static paths = [["supervisor", "action-item-gate"]];
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  runsDir = Option.String("--runs-dir", "");
  registryPath = Option.String("--registry-path", "");
  policyPath = Option.String("--policy-path", "");
  policyJson = Option.String("--policy-json", "");
  manifestPath = Option.String("--manifest-path", "");
  manifestRef = Option.String("--manifest-ref", "");
  manifestFetchCmd = Option.String("--manifest-fetch-cmd", "");
  skipRecoverySweep = Option.Boolean("--skip-recovery-sweep", false);

  async execute() {
    const { buildStateSnapshot } = await import("../../commands/supervisor-state-snapshot.ts");
    const queryDeps = resolveSupervisorQueryDeps(this);
    const snapshotRaw = buildStateSnapshot({
      repo: this.repo,
      factoryId: this.factoryId,
      factoryRoot: this.factoryRoot,
      factoryConfigPath: this.factoryConfigPath,
      targetRepo: this.targetRepo,
      controlPlaneRepo: this.controlPlaneRepo,
      runsDir: this.runsDir,
      registryPath: this.registryPath,
      policyPath: this.policyPath,
      policyJson: this.policyJson,
      manifestPath: this.manifestPath,
      manifestRef: this.manifestRef,
      manifestFetchCmd: this.manifestFetchCmd,
      skipRecoverySweep: this.skipRecoverySweep,
      ...queryDeps,
    });
    let snapshot = {};
    try {
      snapshot = JSON.parse(String(snapshotRaw || "{}"));
    } catch {
      snapshot = {};
    }
    const actionItems = Array.isArray(snapshot?.action_items) ? snapshot.action_items : [];

    // Auto-execute deterministic remediation packets before deciding if LLM is needed.
    const { processActionItems } = await import("../../commands/supervisor-auto-execute.ts");
    const result = processActionItems(actionItems);
    const remaining = result.needsJudgment.length;

    if (result.executed.length > 0) {
      process.stderr.write(
        `[action-item-gate] auto-executed ${result.executed.length} deterministic item(s), ` +
        `${result.skipped.length} skipped, ${result.failed.length} failed, ` +
        `${remaining} need LLM judgment\n`,
      );
    }

    this.context.stdout.write(JSON.stringify({
      has_action_items: remaining > 0 ? "true" : "false",
      action_item_count: remaining,
      auto_executed_count: result.executed.length,
      auto_exec_failed_count: result.failed.length,
      skipped_count: result.skipped.length,
    }));
    return 0;
  }
}

export class SupervisorSanitizeGoalsCommand extends Command {
  static paths = [["supervisor", "sanitize-goals"]];
  repo = Option.String("--repo", "");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "factory_supervisor_tick");
  dryRun = Option.Boolean("--dry-run", false);

  async execute() {
    const { sanitizeSupervisorGoals } = await import("../../commands/supervisor-sanitize-goals.ts");
    const out = sanitizeSupervisorGoals({ repo: this.repo, runId: this.runId, pipeline: this.pipeline, dryRun: this.dryRun });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorNormalizeFeatureLabelsCommand extends Command {
  static paths = [["supervisor", "normalize-feature-labels"]];
  repo = Option.String("--repo", "");
  dryRun = Option.Boolean("--dry-run", false);

  async execute() {
    const { normalizeFeatureLabels } = await import("../../commands/supervisor-normalize-feature-labels.ts");
    const out = normalizeFeatureLabels({ repo: this.repo, dryRun: this.dryRun });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorForceResetBranchCommand extends Command {
  static paths = [["supervisor", "force-reset-branch"]];
  repo = Option.String("--repo", "");
  branch = Option.String("--branch", "");
  issue = Option.String("--issue", "");

  async execute() {
    const { forceResetBranch } = await import("../../commands/supervisor-force-ops.ts");
    const out = forceResetBranch({ repo: this.repo, branch: this.branch, issueNumber: this.issue });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class SupervisorForceCloseGiveUpCommand extends Command {
  static paths = [["supervisor", "force-close-giveup"]];
  repo = Option.String("--repo", "");
  issue = Option.String("--issue", "");
  reason = Option.String("--reason", "");

  async execute() {
    const { forceCloseGiveUp } = await import("../../commands/supervisor-force-ops.ts");
    const out = forceCloseGiveUp({ repo: this.repo, issueNumber: this.issue, reason: this.reason });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class SupervisorAuditBlockedLabelsCommand extends Command {
  static paths = [["supervisor", "audit-blocked-labels"]];
  repo = Option.String("--repo", "");

  async execute() {
    const { auditBlockedLabels } = await import("../../commands/supervisor-audit-blocked-labels.ts");
    const out = auditBlockedLabels({ repo: this.repo });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorSanitizeArtifactLabelsCommand extends Command {
  static paths = [["supervisor", "sanitize-artifact-labels"]];
  repo = Option.String("--repo", "");
  dryRun = Option.Boolean("--dry-run", false);

  async execute() {
    const { sanitizeArtifactLabels } = await import("../../commands/supervisor-sanitize-artifact-labels.ts");
    const out = sanitizeArtifactLabels({ repo: this.repo, dryRun: this.dryRun });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorCloseStaleMergeFollowupsCommand extends Command {
  static paths = [["supervisor", "close-stale-merge-followups"]];
  repo = Option.String("--repo", "");
  dryRun = Option.Boolean("--dry-run", false);
  staleHours = Option.String("--stale-hours", "24");

  async execute() {
    const { closeStaleMergeFollowups } = await import("../../commands/supervisor-close-merge-followups.ts");
    const out = closeStaleMergeFollowups({ repo: this.repo, dryRun: this.dryRun, staleHours: Number(this.staleHours) });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorMergeFailureMetricsCommand extends Command {
  static paths = [["supervisor", "merge-failure-metrics"]];
  repo = Option.String("--repo", "");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "factory_supervisor_tick");

  async execute() {
    const { emitMergeFailureMetrics } = await import("../../commands/supervisor-merge-failure-metrics.ts");
    const out = emitMergeFailureMetrics({ repo: this.repo, runId: this.runId, pipeline: this.pipeline });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorUpdatePrioritiesFromMergeFailuresCommand extends Command {
  static paths = [["supervisor", "update-priorities-from-merge-failures"]];
  repo = Option.String("--repo", "");
  dryRun = Option.Boolean("--dry-run", false);

  async execute() {
    const { updatePrioritiesFromMergeFailures } = await import("../../commands/supervisor-update-priorities-from-merge-failures.ts");
    const out = updatePrioritiesFromMergeFailures({ repo: this.repo, dryRun: this.dryRun });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorDiagnoseStalledWavesCommand extends Command {
  static paths = [["supervisor", "detect-stalled-wave"], ["supervisor", "diagnose-stalled-waves"]];
  repo = Option.String("--repo", "");
  staleMinutes = Option.String("--stale-minutes", "20");
  runsDir = Option.String("--runs-dir", "");

  async execute() {
    const { diagnoseStalledWaves } = await import("../../commands/supervisor-diagnose-stalled-waves.ts");
    const out = diagnoseStalledWaves({ repo: this.repo, staleMinutes: Number(this.staleMinutes), runsDir: this.runsDir });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorExternalFactoryLifecycleCommand extends Command {
  static paths = [["supervisor", "external-factory-lifecycle"]];
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  sourceRepo = Option.String("--source-repo", "");
  sourceIssueNumber = Option.String("--source-issue-number", "0");
  issueNumber = Option.String("--issue-number", "0");
  blockedItems = Option.String("--blocked-items", "[]");
  milestoneTitle = Option.String("--milestone-title", "");
  rolloutChannel = Option.String("--rollout-channel", "");
  policyPath = Option.String("--policy-path", "");
  policyJson = Option.String("--policy-json", "");
  manifestPath = Option.String("--manifest-path", "");
  manifestRef = Option.String("--manifest-ref", "");
  manifestFetchCommand = Option.String("--manifest-fetch-command", "");
  localFactoryRelease = Option.String("--local-factory-release", "");
  localFactoryReleaseCommand = Option.String("--local-factory-release-command", "");
  selfUpdateCommand = Option.String("--self-update-command", "");
  requireRestart = Option.String("--require-restart", "false");
  factoryId = Option.String("--factory-id", "");
  factoryRoot = Option.String("--factory-root", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  logsRoot = Option.String("--logs-root", "");
  runsDir = Option.String("--runs-dir", "");
  tmpDir = Option.String("--tmp-dir", "");
  socketDir = Option.String("--socket-dir", "");
  pidDir = Option.String("--pid-dir", "");
  daemonScript = Option.String("--daemon-script", "");
  detach = Option.String("--detach", "true");
  timeoutMs = Option.String("--timeout-ms", "5000");

  async execute() {
    const { runExternalFactoryLifecycleGate } = await import("../../commands/supervisor-external-factory-lifecycle.ts");
    const out = await runExternalFactoryLifecycleGate({
      controlPlaneRepo: this.controlPlaneRepo,
      sourceRepo: this.sourceRepo,
      sourceIssueNumber: Number(this.sourceIssueNumber),
      issueNumber: Number(this.issueNumber),
      blockedItems: this.blockedItems,
      milestoneTitle: this.milestoneTitle,
      rolloutChannel: this.rolloutChannel,
      policyPath: this.policyPath,
      policyJson: this.policyJson,
      manifestPath: this.manifestPath,
      manifestRef: this.manifestRef,
      manifestFetchCommand: this.manifestFetchCommand,
      localFactoryRelease: this.localFactoryRelease,
      localFactoryReleaseCommand: this.localFactoryReleaseCommand,
      selfUpdateCommand: this.selfUpdateCommand,
      requireRestart: this.requireRestart,
      factoryId: this.factoryId,
      factoryRoot: this.factoryRoot,
      hostBaseDir: this.hostBaseDir,
      logsRoot: this.logsRoot,
      runsDir: this.runsDir,
      tmpDir: this.tmpDir,
      socketDir: this.socketDir,
      pidDir: this.pidDir,
      daemonScript: this.daemonScript,
      detach: this.detach,
      timeoutMs: Number(this.timeoutMs),
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SupervisorTickIdleCheckCommand extends Command {
  static paths = [["supervisor", "tick-idle-check"]];
  inFlightCount = Option.String("--in-flight-count", "0");
  selectedCount = Option.String("--selected-count", "0");
  stalledWaveCount = Option.String("--stalled-wave-count", "0");
  spawnSuccessCount = Option.String("--spawn-success-count", "0");
  runsDir = Option.String("--runs-dir", "");
  factoryId = Option.String("--factory-id", "");
  ghRepo = Option.String("--gh-repo", "");

  async execute() {
    const { countOpenDurablePackets, detectExternalChanges, tickIdleCheck } = await import("../../commands/supervisor-tick-idle-check.ts");
    const openDurablePacketCount = this.runsDir
      ? countOpenDurablePackets({ runsDir: this.runsDir })
      : 0;

    let externalChangesDetected;
    if (this.factoryId) {
      const detection = detectExternalChanges({
        factoryId: this.factoryId,
        ghRepo: this.ghRepo,
      });
      externalChangesDetected = detection.changes_detected;
    }

    const result = tickIdleCheck({
      inFlightCount: this.inFlightCount,
      selectedCount: this.selectedCount,
      stalledWaveCount: this.stalledWaveCount,
      spawnSuccessCount: this.spawnSuccessCount,
      openDurablePacketCount,
      externalChangesDetected,
    });
    this.context.stdout.write(JSON.stringify(result));
    return 0;
  }
}

export class SupervisorTickIdleCursorUpdateCommand extends Command {
  static paths = [["supervisor", "tick-idle-cursor-update"]];
  factoryId = Option.String("--factory-id", "");

  async execute() {
    const { updateTickIdleCursor } = await import("../../commands/supervisor-tick-idle-check.ts");
    const result = updateTickIdleCursor({ factoryId: this.factoryId });
    this.context.stdout.write(JSON.stringify(result));
    return 0;
  }
}

export const supervisorCommands = [
  SupervisorStatusCommand,
  SupervisorHealthCheckCommand,
  SupervisorValidateMainBranchCommand,
  SupervisorRemediateOrphanFeaturesCommand,
  SupervisorFixOrphanFeaturesCommand,
  SupervisorStateSnapshotCommand,
  SupervisorOpenBugGateCommand,
  SupervisorUpstreamBugGateCommand,
  SupervisorManagedLoadContextCommand,
  SupervisorManagedControlGateCommand,
  SupervisorManagedActionItemGateCommand,
  SupervisorManagedIntakeSelectorCommand,
  SupervisorManagedHealthClassifierCommand,
  SupervisorManagedFailureClassifierCommand,
  SupervisorManagedEmitRunSummaryCommand,
  SupervisorManagedPersistStateCommand,
  SupervisorManagedDomainContractCommand,
  SupervisorEmitBugCommand,
  SupervisorEnsureHumanBlockerCommand,
  SupervisorActionItemGateCommand,
  SupervisorSanitizeGoalsCommand,
  SupervisorNormalizeFeatureLabelsCommand,
  SupervisorForceResetBranchCommand,
  SupervisorForceCloseGiveUpCommand,
  SupervisorAuditBlockedLabelsCommand,
  SupervisorSanitizeArtifactLabelsCommand,
  SupervisorCloseStaleMergeFollowupsCommand,
  SupervisorMergeFailureMetricsCommand,
  SupervisorUpdatePrioritiesFromMergeFailuresCommand,
  SupervisorDiagnoseStalledWavesCommand,
  SupervisorExternalFactoryLifecycleCommand,
  SupervisorTickIdleCheckCommand,
  SupervisorTickIdleCursorUpdateCommand,
];
