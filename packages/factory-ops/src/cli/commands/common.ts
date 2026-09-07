import { Command, Option } from "clipanion";

import { resolveJsonPayload } from "../helpers.ts";

async function resolveFactoryContextOrExit(command, options = {}) {
  try {
    const { resolveFactoryContext } = await import("../../lib/factory-context-resolver.ts");
    return resolveFactoryContext(options);
  } catch (error) {
    command.context.stderr.write(String(error?.message || error) + "\n");
    return null;
  }
}

export class CommonResolveGhRepoCommand extends Command {
  static paths = [["common", "resolve-gh-repo"]];
  ghRepo = Option.String("--gh-repo", "");
  factoryRoot = Option.String("--factory-root", "");
  configPath = Option.String("--config-path", "");

  async execute() {
    const { resolveGhRepo } = await import("../../commands/common-resolve-gh-repo.ts");
    try {
      this.context.stdout.write(resolveGhRepo(this.ghRepo, { factoryRoot: this.factoryRoot, configPath: this.configPath }));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}

export class CommonResolveDefaultCommand extends Command {
  static paths = [["common", "resolve-default"]];
  value = Option.String("--value", "");
  fallback = Option.String("--fallback", "");

  async execute() {
    const { resolveDefault } = await import("../../commands/common-resolve-default.ts");
    this.context.stdout.write(resolveDefault(this.value, this.fallback));
    return 0;
  }
}

export class CommonResolveCapabilityCodingSkillsPathCommand extends Command {
  static paths = [["common", "resolve-capability-coding-skills-path"]];

  async execute() {
    try {
      const { resolveCapabilityCodingSkillsPath } = await import("../../commands/common-resolve-default.ts");
      this.context.stdout.write(resolveCapabilityCodingSkillsPath());
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}

export class CommonResolveBooleanCommand extends Command {
  static paths = [["common", "resolve-boolean"]];
  value = Option.String("--value", "");
  fallback = Option.String("--fallback", "false");

  async execute() {
    const { resolveBoolean } = await import("../../commands/common-resolve-default.ts");
    this.context.stdout.write(resolveBoolean(this.value, this.fallback === "true"));
    return 0;
  }
}

export class CommonResolveCapabilityMergeSkillsPathCommand extends Command {
  static paths = [["common", "resolve-capability-merge-skills-path"]];

  async execute() {
    try {
      const { resolveCapabilityMergeSkillsPath } = await import("../../commands/common-resolve-default.ts");
      this.context.stdout.write(resolveCapabilityMergeSkillsPath());
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}

export class CommonResolveCapabilityCodingSkillsCommand extends Command {
  static paths = [["common", "resolve-capability-coding-skills"]];
  graphExport = Option.String("--graph-export", "packages/capability-coding/workflows/issue_execute_item/issue_execute_item.workflow-source.mjs");

  async execute() {
    const { resolveCapabilityCodingSkillsPath } = await import("../../commands/common-resolve-default.ts");
    try {
      this.context.stdout.write(resolveCapabilityCodingSkillsPath({ graphExport: this.graphExport }));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}

export class CommonResolveCapabilityMergeSkillsCommand extends Command {
  static paths = [["common", "resolve-capability-merge-skills"]];
  graphExport = Option.String("--graph-export", "packages/capability-merge/workflows/merge_item/merge_item.workflow-source.mjs");

  async execute() {
    const { resolveCapabilityMergeSkillsPath } = await import("../../commands/common-resolve-default.ts");
    try {
      this.context.stdout.write(resolveCapabilityMergeSkillsPath({ graphExport: this.graphExport }));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}

export class CommonResolveCapabilityGoalDecompositionSkillsPathCommand extends Command {
  static paths = [["common", "resolve-capability-goal-decomposition-skills-path"]];

  async execute() {
    try {
      const { resolveCapabilityGoalDecompositionSkillsPath } = await import("../../commands/common-resolve-default.ts");
      this.context.stdout.write(resolveCapabilityGoalDecompositionSkillsPath());
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}

export class CommonResolveCapabilityBrainstormingSkillsPathCommand extends Command {
  static paths = [["common", "resolve-capability-brainstorming-skills-path"]];

  async execute() {
    try {
      const { resolveCapabilityBrainstormingSkillsPath } = await import("../../commands/common-resolve-default.ts");
      this.context.stdout.write(resolveCapabilityBrainstormingSkillsPath());
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}

export class CommonResolveCapabilityGoalDecompositionSkillsCommand extends Command {
  static paths = [["common", "resolve-capability-goal-decomposition-skills"]];
  graphExport = Option.String("--graph-export", "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs");

  async execute() {
    const { resolveCapabilityGoalDecompositionSkillsPath } = await import("../../commands/common-resolve-default.ts");
    try {
      this.context.stdout.write(resolveCapabilityGoalDecompositionSkillsPath({ graphExport: this.graphExport }));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}

export class CommonResolveCapabilityBrainstormingSkillsCommand extends Command {
  static paths = [["common", "resolve-capability-brainstorming-skills"]];
  graphExport = Option.String("--graph-export", "packages/capability-brainstorming/workflows/brainstorm/brainstorm.workflow-source.mjs");

  async execute() {
    const { resolveCapabilityBrainstormingSkillsPath } = await import("../../commands/common-resolve-default.ts");
    try {
      this.context.stdout.write(resolveCapabilityBrainstormingSkillsPath({ graphExport: this.graphExport }));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}

export class CommonResolveFactoryConfigCommand extends Command {
  static paths = [["common", "resolve-factory-config"]];
  key = Option.String("--key", "");
  fallback = Option.String("--fallback", "");
  configPath = Option.String("--config-path", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");

  async execute() {
    const { resolveFactoryConfigValue } = await import("../../commands/common-resolve-default.ts");
    const context = await resolveFactoryContextOrExit(this, {
      factoryRoot: this.factoryRoot,
      factoryConfigPath: this.factoryConfigPath || this.configPath,
      factoryId: this.factoryId,
      targetRepo: this.repo,
      controlPlaneRepo: this.controlPlaneRepo,
      scenariosRoot: this.scenariosRoot,
    });
    if (!context) return 2;
    this.context.stdout.write(resolveFactoryConfigValue({
      key: this.key,
      fallback: this.fallback,
      configPath: context.factory_config_path,
    }));
    return 0;
  }
}

export class CommonResolveGoalDecompositionTimeoutCommand extends Command {
  static paths = [["common", "resolve-goal-decomposition-timeout"]];
  stage = Option.String("--stage", { required: true });
  configPath = Option.String("--config-path", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");

  async execute() {
    const { resolveGoalDecompositionTimeout } = await import("../../commands/common-resolve-default.ts");
    const context = await resolveFactoryContextOrExit(this, {
      factoryRoot: this.factoryRoot,
      factoryConfigPath: this.factoryConfigPath || this.configPath,
      factoryId: this.factoryId,
      targetRepo: this.repo,
      controlPlaneRepo: this.controlPlaneRepo,
      scenariosRoot: this.scenariosRoot,
    });
    if (!context) return 2;

    try {
      const { readFileSync } = await import("node:fs");
      const parsedFactoryConfig = JSON.parse(readFileSync(context.factory_config_path, "utf8"));
      this.context.stdout.write(resolveGoalDecompositionTimeout({
        stage: this.stage,
        factoryConfig: parsedFactoryConfig,
      }));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}

export class CommonResolveIntentStackCommand extends Command {
  static paths = [["common", "resolve-intent-stack"]];
  factoryRoot = Option.String("--factory-root", "");
  configPath = Option.String("--config-path", "");
  platformIntentPath = Option.String("--platform-intent-path", "");
  factoryIntentPath = Option.String("--factory-intent-path", "");
  workIntent = Option.String("--work-intent", "");

  async execute() {
    const { resolveIntentStack } = await import("../../commands/common-resolve-intent-stack.ts");
    try {
      const out = resolveIntentStack({
        factoryRoot: this.factoryRoot,
        configPath: this.configPath,
        platformIntentPath: this.platformIntentPath,
        factoryIntentPath: this.factoryIntentPath,
        workIntent: this.workIntent,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}

export class CommonLoadAgentGuidanceContextCommand extends Command {
  static paths = [["common", "load-agent-guidance-context"]];
  repoRoot = Option.String("--repo-root", ".");
  agentsPath = Option.String("--agents-path", "");
  agentLearningsPath = Option.String("--agent-learnings-path", "");
  agentsMaxChars = Option.String("--agents-max-chars", "12000");
  learningsMaxChars = Option.String("--learnings-max-chars", "12000");
  learningsEntryCount = Option.String("--learnings-entry-count", "5");

  async execute() {
    const { loadAgentGuidanceContext } = await import("../../commands/common-load-agent-guidance.ts");
    try {
      const out = loadAgentGuidanceContext({
        repoRoot: this.repoRoot,
        agentsPath: this.agentsPath,
        agentLearningsPath: this.agentLearningsPath,
        agentsMaxChars: this.agentsMaxChars,
        learningsMaxChars: this.learningsMaxChars,
        learningsEntryCount: this.learningsEntryCount,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
  }
}

export class CommonNormalizeApprovedCommand extends Command {
  static paths = [["common", "normalize-approved"]];
  value = Option.String("--value", "");

  async execute() {
    const { normalizeApproved } = await import("../../commands/common-resolve-default.ts");
    this.context.stdout.write(normalizeApproved(this.value));
    return 0;
  }
}

export class CommonNormalizeDecisionCommand extends Command {
  static paths = [["common", "normalize-decision"]];
  value = Option.String("--value", "");

  async execute() {
    const { normalizeDecision } = await import("../../commands/common-resolve-default.ts");
    this.context.stdout.write(normalizeDecision(this.value));
    return 0;
  }
}

export class CommonValidateIssueSpecDraftCommand extends Command {
  static paths = [["common", "validate-issue-spec-draft"]];
  issueSpec = Option.String("--issue-spec", { required: false });
  issueSpecB64 = Option.String("--issue-spec-b64", { required: false });
  feature = Option.String("--feature", { required: false });
  featureB64 = Option.String("--feature-b64", { required: false });

  async execute() {
    const issueSpecRaw = this.issueSpecB64 !== undefined
      ? Buffer.from(this.issueSpecB64, "base64").toString("utf8")
      : (this.issueSpec ?? "");
    const featureRaw = this.featureB64 !== undefined
      ? Buffer.from(this.featureB64, "base64").toString("utf8")
      : (this.feature ?? "");
    const { validateIssueSpecDraft } = await import("../../commands/common-resolve-default.ts");
    this.context.stdout.write(validateIssueSpecDraft(issueSpecRaw, featureRaw));
    return 0;
  }
}

export class CommonIncrementCounterCommand extends Command {
  static paths = [["common", "increment-counter"]];
  value = Option.String("--value", "0");

  async execute() {
    const { incrementCounter } = await import("../../commands/common-resolve-default.ts");
    this.context.stdout.write(incrementCounter(this.value));
    return 0;
  }
}

export class CommonBuildRetrySignalCommand extends Command {
  static paths = [["common", "build-retry-signal"]];
  decomposeParseStatus = Option.String("--decompose-parse-status", "");
  decomposeParseError = Option.String("--decompose-parse-error", "");
  decomposeAttempts = Option.String("--decompose-attempts", "");

  async execute() {
    const { buildRetrySignal } = await import("../../commands/common-resolve-default.ts");
    this.context.stdout.write(buildRetrySignal({
      decomposeParseStatus: this.decomposeParseStatus,
      decomposeParseError: this.decomposeParseError,
      decomposeAttempts: this.decomposeAttempts,
    }));
    return 0;
  }
}

export class CommonCountJsonCommand extends Command {
  static paths = [["common", "count-json"]];
  raw = Option.String("--raw", { required: false });
  rawB64 = Option.String("--raw-b64", { required: false });

  async execute() {
    const { countJsonItems } = await import("../../commands/common-resolve-default.ts");
    let payload;
    try {
      payload = await resolveJsonPayload({
        flag: this.raw,
        flagB64: this.rawB64,
        flagName: "raw",
        allowStdin: true,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    this.context.stdout.write(countJsonItems(payload || "[]"));
    return 0;
  }
}

export class CommonCountFeatureObjectsCommand extends Command {
  static paths = [["common", "count-feature-objects"]];
  raw = Option.String("--raw", { required: false });
  rawB64 = Option.String("--raw-b64", { required: false });

  async execute() {
    const { countFeatureObjects } = await import("../../commands/common-resolve-default.ts");
    let payload;
    try {
      payload = await resolveJsonPayload({
        flag: this.raw,
        flagB64: this.rawB64,
        flagName: "raw",
        allowStdin: true,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    this.context.stdout.write(countFeatureObjects(payload || "[]"));
    return 0;
  }
}

export class CommonInspectJsonCommand extends Command {
  static paths = [["common", "inspect-json"]];
  raw = Option.String("--raw", { required: false });
  rawB64 = Option.String("--raw-b64", { required: false });
  file = Option.String("--file", "");

  async execute() {
    const { inspectJson } = await import("../../commands/common-resolve-default.ts");
    let payload;
    try {
      payload = await resolveJsonPayload({
        flag: this.raw,
        flagB64: this.rawB64,
        flagName: "raw",
        allowStdin: true,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    this.context.stdout.write(inspectJson(payload || "", this.file));
    return 0;
  }
}

export class CommonFallbackJsonCommand extends Command {
  static paths = [["common", "fallback-json"]];
  raw = Option.String("--raw", { required: false });
  rawB64 = Option.String("--raw-b64", { required: false });
  file = Option.String("--file", "");
  goalNumber = Option.String("--goal-number", { required: false });
  goalTitle = Option.String("--goal-title", { required: false });

  async execute() {
    const { fallbackJson } = await import("../../commands/common-resolve-default.ts");
    let payload;
    try {
      payload = await resolveJsonPayload({
        flag: this.raw,
        flagB64: this.rawB64,
        flagName: "raw",
        allowStdin: true,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    this.context.stdout.write(fallbackJson(payload || "", this.file, { goalNumber: this.goalNumber, goalTitle: this.goalTitle }));
    return 0;
  }
}

export class CommonInspectJsonPairCommand extends Command {
  static paths = [["common", "inspect-json-pair"]];
  primary = Option.String("--primary", { required: false });
  primaryB64 = Option.String("--primary-b64", { required: false });
  secondary = Option.String("--secondary", { required: false });
  secondaryB64 = Option.String("--secondary-b64", { required: false });

  async execute() {
    const { inspectJsonPair } = await import("../../commands/common-resolve-default.ts");
    let primary;
    let secondary;
    try {
      primary = await resolveJsonPayload({
        flag: this.primary,
        flagB64: this.primaryB64,
        flagName: "primary",
        allowStdin: true,
      });
      secondary = await resolveJsonPayload({
        flag: this.secondary,
        flagB64: this.secondaryB64,
        flagName: "secondary",
        allowStdin: false,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    this.context.stdout.write(inspectJsonPair(primary || "", secondary || ""));
    return 0;
  }
}

export class CommonFallbackJsonPairCommand extends Command {
  static paths = [["common", "fallback-json-pair"]];
  primary = Option.String("--primary", { required: false });
  primaryB64 = Option.String("--primary-b64", { required: false });
  secondary = Option.String("--secondary", { required: false });
  secondaryB64 = Option.String("--secondary-b64", { required: false });

  async execute() {
    const { fallbackJsonPair } = await import("../../commands/common-resolve-default.ts");
    let primary;
    let secondary;
    try {
      primary = await resolveJsonPayload({
        flag: this.primary,
        flagB64: this.primaryB64,
        flagName: "primary",
        allowStdin: true,
      });
      secondary = await resolveJsonPayload({
        flag: this.secondary,
        flagB64: this.secondaryB64,
        flagName: "secondary",
        allowStdin: false,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    this.context.stdout.write(fallbackJsonPair(primary || "", secondary || ""));
    return 0;
  }
}

export class CommonFallbackIssueSpecCommand extends Command {
  static paths = [["common", "fallback-issue-spec"]];
  issueSpec = Option.String("--issue-spec", { required: false });
  issueSpecB64 = Option.String("--issue-spec-b64", { required: false });
  feature = Option.String("--feature", { required: false });
  featureB64 = Option.String("--feature-b64", { required: false });

  async execute() {
    const { fallbackIssueSpec } = await import("../../commands/common-resolve-default.ts");
    let issueSpec;
    let feature;
    try {
      issueSpec = await resolveJsonPayload({
        flag: this.issueSpec,
        flagB64: this.issueSpecB64,
        flagName: "issue-spec",
        allowStdin: true,
      });
      feature = await resolveJsonPayload({
        flag: this.feature,
        flagB64: this.featureB64,
        flagName: "feature",
        allowStdin: false,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    this.context.stdout.write(fallbackIssueSpec(issueSpec || "", feature || ""));
    return 0;
  }
}

export class CommonFallbackIssueSpecBundleCommand extends Command {
  static paths = [["common", "fallback-issue-spec-bundle"]];
  issueSpec = Option.String("--issue-spec", { required: false });
  issueSpecB64 = Option.String("--issue-spec-b64", { required: false });
  feature = Option.String("--feature", { required: false });
  featureB64 = Option.String("--feature-b64", { required: false });

  async execute() {
    const { fallbackIssueSpecBundle } = await import("../../commands/common-resolve-default.ts");
    let issueSpec;
    let feature;
    try {
      issueSpec = await resolveJsonPayload({
        flag: this.issueSpec,
        flagB64: this.issueSpecB64,
        flagName: "issue-spec",
        allowStdin: true,
      });
      feature = await resolveJsonPayload({
        flag: this.feature,
        flagB64: this.featureB64,
        flagName: "feature",
        allowStdin: false,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    this.context.stdout.write(fallbackIssueSpecBundle(issueSpec || "", feature || ""));
    return 0;
  }
}

export class CommonNormalizeFeatureIssueSpecCommand extends Command {
  static paths = [["common", "normalize-feature-issue-spec"]];
  issueSpec = Option.String("--issue-spec", { required: false });
  issueSpecB64 = Option.String("--issue-spec-b64", { required: false });
  feature = Option.String("--feature", { required: false });
  featureB64 = Option.String("--feature-b64", { required: false });

  async execute() {
    const { normalizeFeatureIssueSpec } = await import("../../commands/common-resolve-default.ts");
    let issueSpec;
    let feature;
    try {
      issueSpec = await resolveJsonPayload({
        flag: this.issueSpec,
        flagB64: this.issueSpecB64,
        flagName: "issue-spec",
        allowStdin: true,
      });
      feature = await resolveJsonPayload({
        flag: this.feature,
        flagB64: this.featureB64,
        flagName: "feature",
        allowStdin: false,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    this.context.stdout.write(normalizeFeatureIssueSpec(issueSpec || "", feature || ""));
    return 0;
  }
}

export class CommonNormalizeFeatureIssueSpecBundleCommand extends Command {
  static paths = [["common", "normalize-feature-issue-spec-bundle"]];
  issueSpec = Option.String("--issue-spec", { required: false });
  issueSpecB64 = Option.String("--issue-spec-b64", { required: false });
  feature = Option.String("--feature", { required: false });
  featureB64 = Option.String("--feature-b64", { required: false });

  async execute() {
    const { normalizeFeatureIssueSpecBundle } = await import("../../commands/common-resolve-default.ts");
    let issueSpec;
    let feature;
    try {
      issueSpec = await resolveJsonPayload({
        flag: this.issueSpec,
        flagB64: this.issueSpecB64,
        flagName: "issue-spec",
        allowStdin: true,
      });
      feature = await resolveJsonPayload({
        flag: this.feature,
        flagB64: this.featureB64,
        flagName: "feature",
        allowStdin: false,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    this.context.stdout.write(normalizeFeatureIssueSpecBundle(issueSpec || "", feature || ""));
    return 0;
  }
}

export class CommonNormalizeIssueUrlsCommand extends Command {
  static paths = [["common", "normalize-issue-urls"]];
  raw = Option.String("--raw", { required: false });
  rawB64 = Option.String("--raw-b64", { required: false });

  async execute() {
    const { normalizeIssueUrlArray } = await import("../../commands/common-resolve-default.ts");
    let payload;
    try {
      payload = await resolveJsonPayload({
        flag: this.raw,
        flagB64: this.rawB64,
        flagName: "raw",
        allowStdin: true,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    this.context.stdout.write(normalizeIssueUrlArray(payload || "[]"));
    return 0;
  }
}

export class CommonEncodeBase64Command extends Command {
  static paths = [["common", "encode-base64"]];
  raw = Option.String("--raw", { required: false });

  async execute() {
    const { readStdin } = await import("../helpers.ts");
    const payload = this.raw !== undefined ? this.raw : ((await readStdin()) || "");
    this.context.stdout.write(Buffer.from(String(payload), "utf8").toString("base64"));
    return 0;
  }
}

export class CommonCreateIssueCommand extends Command {
  static paths = [["common", "create-issue"]];
  repo = Option.String("--repo", "");
  issueSpec = Option.String("--issue-spec", { required: false });
  issueSpecB64 = Option.String("--issue-spec-b64", { required: false });

  async execute() {
    const { createGitHubIssueFromSpec } = await import("../../commands/common-create-issue.ts");
    let payload;
    try {
      payload = await resolveJsonPayload({
        flag: this.issueSpec,
        flagB64: this.issueSpecB64,
        flagName: "issue-spec",
        allowStdin: true,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    const out = createGitHubIssueFromSpec({ repo: this.repo, issueSpecRaw: payload || "{}" });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class CommonUpdateIssueCommand extends Command {
  static paths = [["common", "update-issue"]];
  repo = Option.String("--repo", "");
  issueUrl = Option.String("--issue-url", "");
  issueSpec = Option.String("--issue-spec", { required: false });
  issueSpecB64 = Option.String("--issue-spec-b64", { required: false });

  async execute() {
    const { updateGitHubIssueFromSpec } = await import("../../commands/common-create-issue.ts");
    let payload;
    try {
      payload = await resolveJsonPayload({
        flag: this.issueSpec,
        flagB64: this.issueSpecB64,
        flagName: "issue-spec",
        allowStdin: true,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    const out = updateGitHubIssueFromSpec({
      repo: this.repo,
      issueUrl: this.issueUrl,
      issueSpecRaw: payload || "{}",
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class CommonCeremonyGoalReviewCommand extends Command {
  static paths = [["common", "ceremony-goal-review"]];
  goalCount = Option.String("--goal-count", "");
  skipReviewSingleGoal = Option.String("--skip-review-single-goal", "false");
  pipeline = Option.String("--pipeline", "goal_batch");

  async execute() {
    const { shouldSkipGoalReview } = await import("../../commands/ceremony-heuristics.ts");
    const out = shouldSkipGoalReview({
      goalCount: this.goalCount,
      skipReviewSingleGoal: this.skipReviewSingleGoal,
      pipeline: this.pipeline,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class CommonCeremonyDecomposeAutoApproveCommand extends Command {
  static paths = [["common", "ceremony-decompose-auto-approve"]];
  features = Option.String("--features", { required: false });
  featuresB64 = Option.String("--features-b64", { required: false });
  decomposeAutoApprove = Option.String("--decompose-auto-approve", "false");
  maxFeatures = Option.String("--max-features", "2");
  maxCriteriaPerFeature = Option.String("--max-criteria-per-feature", "2");
  pipeline = Option.String("--pipeline", "goal_intake_decompose");

  async execute() {
    const { decomposeAutoApproveDecision } = await import("../../commands/ceremony-heuristics.ts");
    let featuresPayload;
    try {
      featuresPayload = await resolveJsonPayload({
        flag: this.features,
        flagB64: this.featuresB64,
        flagName: "features",
        allowStdin: true,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }

    const out = decomposeAutoApproveDecision({
      features: featuresPayload || "[]",
      decomposeAutoApprove: this.decomposeAutoApprove,
      maxFeatures: this.maxFeatures,
      maxCriteriaPerFeature: this.maxCriteriaPerFeature,
      pipeline: this.pipeline,
    });

    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class CommonCeremonyIssueJudgeCommand extends Command {
  static paths = [["common", "ceremony-issue-judge"]];
  issueSpec = Option.String("--issue-spec", { required: false });
  issueSpecB64 = Option.String("--issue-spec-b64", { required: false });
  feature = Option.String("--feature", { required: false });
  featureB64 = Option.String("--feature-b64", { required: false });
  skipTrivialJudge = Option.String("--skip-trivial-judge", "false");
  pipeline = Option.String("--pipeline", "write_issue_item");

  async execute() {
    const { shouldSkipIssueJudge } = await import("../../commands/ceremony-heuristics.ts");
    let issueSpecPayload;
    let featurePayload;

    try {
      issueSpecPayload = await resolveJsonPayload({
        flag: this.issueSpec,
        flagB64: this.issueSpecB64,
        flagName: "issue-spec",
        allowStdin: true,
      });
      featurePayload = await resolveJsonPayload({
        flag: this.feature,
        flagB64: this.featureB64,
        flagName: "feature",
        allowStdin: false,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }

    const out = shouldSkipIssueJudge({
      issueSpec: issueSpecPayload || "{}",
      feature: featurePayload || "{}",
      skipTrivialJudge: this.skipTrivialJudge,
      pipeline: this.pipeline,
    });

    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class CommonCeremonyClassifyMilestoneCommand extends Command {
  static paths = [["common", "ceremony-classify-milestone"]];
  complexityClass = Option.String("--complexity-class", "");
  milestoneParallelLowEnabled = Option.String("--milestone-parallel-low-enabled", "false");
  pipeline = Option.String("--pipeline", "milestone_execute");

  async execute() {
    const { classifyMilestoneIssueComplexity } = await import("../../commands/ceremony-heuristics.ts");
    const out = classifyMilestoneIssueComplexity({
      complexityClass: this.complexityClass,
      milestoneParallelLowEnabled: this.milestoneParallelLowEnabled,
      pipeline: this.pipeline,
    });

    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class CommonCeremonyBuildMilestoneBatchCommand extends Command {
  static paths = [["common", "ceremony-build-milestone-batch"]];
  issues = Option.String("--issues", { required: false });
  issuesB64 = Option.String("--issues-b64", { required: false });
  maxParallel = Option.String("--max-parallel", "3");
  pipeline = Option.String("--pipeline", "milestone_execute");

  async execute() {
    const { buildMilestoneParallelBatch } = await import("../../commands/ceremony-heuristics.ts");
    let issuesPayload = "";

    try {
      issuesPayload = await resolveJsonPayload({
        flag: this.issues,
        flagB64: this.issuesB64,
        flagName: "issues",
        allowStdin: false,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }

    const out = buildMilestoneParallelBatch({
      issues: issuesPayload || "[]",
      maxParallel: this.maxParallel,
      pipeline: this.pipeline,
    });

    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export const commonCommands = [
  CommonResolveGhRepoCommand,
  CommonResolveDefaultCommand,
  CommonResolveCapabilityCodingSkillsPathCommand,
  CommonResolveBooleanCommand,
  CommonResolveCapabilityMergeSkillsPathCommand,
  CommonResolveCapabilityGoalDecompositionSkillsPathCommand,
  CommonResolveCapabilityBrainstormingSkillsPathCommand,
  CommonResolveCapabilityCodingSkillsCommand,
  CommonResolveCapabilityMergeSkillsCommand,
  CommonResolveCapabilityGoalDecompositionSkillsCommand,
  CommonResolveCapabilityBrainstormingSkillsCommand,
  CommonResolveFactoryConfigCommand,
  CommonResolveGoalDecompositionTimeoutCommand,
  CommonResolveIntentStackCommand,
  CommonLoadAgentGuidanceContextCommand,
  CommonNormalizeApprovedCommand,
  CommonNormalizeDecisionCommand,
  CommonValidateIssueSpecDraftCommand,
  CommonIncrementCounterCommand,
  CommonBuildRetrySignalCommand,
  CommonCountJsonCommand,
  CommonCountFeatureObjectsCommand,
  CommonInspectJsonCommand,
  CommonFallbackJsonCommand,
  CommonInspectJsonPairCommand,
  CommonFallbackJsonPairCommand,
  CommonFallbackIssueSpecCommand,
  CommonFallbackIssueSpecBundleCommand,
  CommonNormalizeFeatureIssueSpecCommand,
  CommonNormalizeFeatureIssueSpecBundleCommand,
  CommonNormalizeIssueUrlsCommand,
  CommonEncodeBase64Command,
  CommonCreateIssueCommand,
  CommonUpdateIssueCommand,
  CommonCeremonyGoalReviewCommand,
  CommonCeremonyDecomposeAutoApproveCommand,
  CommonCeremonyIssueJudgeCommand,
  CommonCeremonyClassifyMilestoneCommand,
  CommonCeremonyBuildMilestoneBatchCommand,
];
