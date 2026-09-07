import { Command, Option } from "clipanion";

import {
  parseNonNegativeNumber,
  parsePositiveNumber,
} from "../helpers.ts";
import {
  parseRequiredReleaseContractInput,
  parseRequiredReleaseContractPair,
} from "../release-contract-transport.ts";

export class ReleaseBuildSlackBlocksCommand extends Command {
  static paths = [["release", "build-slack-blocks"]];

  contextRaw = Option.String("--context", { required: false });
  contextB64 = Option.String("--context-b64", { required: false });
  narrativeRaw = Option.String("--narrative", { required: false });
  narrativeB64 = Option.String("--narrative-b64", { required: false });
  reportIssueUrl = Option.String("--report-issue-url", { required: false });

  async execute() {
    const { buildReleaseSlackBlocksPayload } = await import("../../commands/release-build-slack-blocks.ts");
    const {
      assertReleaseNarrativeContract,
      assertReleaseReportContextContract,
      assertReleaseSlackPayloadContract,
    } = await import("../../../../capability-release-reporting/src/release-action-contracts.ts");

    const parsed = parseRequiredReleaseContractPair({
      context: this.context,
      operation: "release build-slack-blocks",
      leftRaw: this.contextRaw,
      leftB64: this.contextB64,
      leftLabel: "context",
      leftValidate: assertReleaseReportContextContract,
      rightRaw: this.narrativeRaw,
      rightB64: this.narrativeB64,
      rightLabel: "narrative",
      rightValidate: assertReleaseNarrativeContract,
    });
    if (!parsed.ok) return 1;

    try {
      const payload = assertReleaseSlackPayloadContract(buildReleaseSlackBlocksPayload({
        context: parsed.left,
        narrative: parsed.right,
        reportIssueUrl: this.reportIssueUrl || "",
      }));
      this.context.stdout.write(JSON.stringify(payload));
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 1;
    }
  }
}

export class ReleasePostToSlackCommand extends Command {
  static paths = [["release", "post-to-slack"]];

  contextRaw = Option.String("--context", { required: false });
  contextB64 = Option.String("--context-b64", { required: false });
  payloadRaw = Option.String("--payload", { required: false });
  payloadB64 = Option.String("--payload-b64", { required: false });
  webhookUrl = Option.String("--webhook-url", "");
  factoryRoot = Option.String("--factory-root", "");
  configPath = Option.String("--config-path", "");
  maxAttempts = Option.String("--max-attempts", "3");
  retryDelayMs = Option.String("--retry-delay-ms", "250");

  async execute() {
    const { postReleaseToSlack } = await import("../../commands/release-post-to-slack.ts");
    const {
      assertReleaseReportContextContract,
      assertReleaseSlackPayloadContract,
    } = await import("../../../../capability-release-reporting/src/release-action-contracts.ts");

    const parsed = parseRequiredReleaseContractPair({
      context: this.context,
      operation: "release post-to-slack",
      leftRaw: this.contextRaw,
      leftB64: this.contextB64,
      leftLabel: "context",
      leftValidate: assertReleaseReportContextContract,
      rightRaw: this.payloadRaw,
      rightB64: this.payloadB64,
      rightLabel: "payload",
      rightValidate: assertReleaseSlackPayloadContract,
    });
    if (!parsed.ok) return 1;

    const explicitConfigPath = String(this.configPath || "").trim();
    let factoryConfigWebhookUrl = "";
    try {
      const { loadFactoryConfig } = await import("../../commands/factory-config-loader.ts");
      const loaded = loadFactoryConfig({
        factoryRoot: this.factoryRoot,
        configPath: this.configPath,
        requiredKeys: [],
      });
      factoryConfigWebhookUrl = String(loaded?.config?.slack_webhook_url || "").trim();
    } catch (error) {
      if (explicitConfigPath) {
        this.context.stderr.write(`release post-to-slack config load failed: ${String(error?.message || error)}\n`);
        return 1;
      }
    }

    const result = await postReleaseToSlack({
      context: parsed.left,
      payload: parsed.right,
      webhookUrl: this.webhookUrl,
      factoryConfigWebhookUrl,
      maxAttempts: parsePositiveNumber(this.maxAttempts, 3),
      retryDelayMs: parseNonNegativeNumber(this.retryDelayMs, 250),
    });

    this.context.stdout.write(JSON.stringify(result));
    return 0;
  }
}

export class ReleasePublishReportCommand extends Command {
  static paths = [["release", "publish-report"]];

  contextRaw = Option.String("--context", { required: false });
  contextB64 = Option.String("--context-b64", { required: false });
  narrativeRaw = Option.String("--narrative", { required: false });
  narrativeB64 = Option.String("--narrative-b64", { required: false });
  repo = Option.String("--repo", "");

  async execute() {
    const { publishReleaseReportIssue } = await import("../../commands/release-publish-report.ts");
    const {
      assertReleaseNarrativeContract,
      assertReleaseReportContextContract,
    } = await import("../../../../capability-release-reporting/src/release-action-contracts.ts");

    const parsed = parseRequiredReleaseContractPair({
      context: this.context,
      operation: "release publish-report",
      leftRaw: this.contextRaw,
      leftB64: this.contextB64,
      leftLabel: "context",
      leftValidate: assertReleaseReportContextContract,
      rightRaw: this.narrativeRaw,
      rightB64: this.narrativeB64,
      rightLabel: "narrative",
      rightValidate: assertReleaseNarrativeContract,
    });
    if (!parsed.ok) return 1;

    const result = publishReleaseReportIssue({
      repo: String(this.repo || "").trim() || String(parsed.left?.repo || "").trim(),
      context: parsed.left,
      narrative: parsed.right,
    });
    this.context.stdout.write(JSON.stringify(result));
    return 0;
  }
}

export class ReleaseUpdateDedupCursorCommand extends Command {
  static paths = [["release", "update-dedup-cursor"]];

  contextRaw = Option.String("--context", { required: false });
  contextB64 = Option.String("--context-b64", { required: false });
  deliveryStatus = Option.String("--delivery-status", "");
  factoryId = Option.String("--factory-id", "");
  rootDir = Option.String("--root-dir", ".");

  async execute() {
    const { updateReleaseDedupCursorFromDelivery } = await import("../../commands/release-dedup-cursor.ts");
    const {
      assertReleaseReportContextContract,
      normalizeReleaseDeliveryStatusContract,
    } = await import("../../../../capability-release-reporting/src/release-action-contracts.ts");

    const parsed = parseRequiredReleaseContractInput({
      context: this.context,
      operation: "release update-dedup-cursor",
      raw: this.contextRaw,
      b64: this.contextB64,
      label: "context",
      validate: assertReleaseReportContextContract,
    });
    if (!parsed.ok) return 1;

    let deliveryStatusValue = String(this.deliveryStatus || "").trim();
    try {
      deliveryStatusValue = normalizeReleaseDeliveryStatusContract(JSON.parse(deliveryStatusValue)).status;
    } catch {}

    const result = updateReleaseDedupCursorFromDelivery({
      factoryId: this.factoryId,
      rootDir: this.rootDir,
      reportContext: parsed.value,
      deliveryStatus: deliveryStatusValue,
    });

    this.context.stdout.write(JSON.stringify(result));
    return 0;
  }
}

export class ReleaseEmitNarrativeDocumentCommand extends Command {
  static paths = [["release", "emit-narrative-document"]];

  contextRaw = Option.String("--context", { required: false });
  contextB64 = Option.String("--context-b64", { required: false });
  narrativeRaw = Option.String("--narrative", { required: false });
  narrativeB64 = Option.String("--narrative-b64", { required: false });
  issueUrl = Option.String("--issue-url", "");
  repoPath = Option.String("--repo-path", ".");
  outputDir = Option.String("--output-dir", "");
  factoryId = Option.String("--factory-id", "");
  taxonomyJson = Option.String("--taxonomy-json", "");
  category = Option.String("--category", "");
  tagsJson = Option.String("--tags-json", "");
  topicsJson = Option.String("--topics-json", "");
  publishable = Option.String("--publishable", "");
  containsInternalOnly = Option.String("--contains-internal-only", "");
  internalOnlySectionsJson = Option.String("--internal-only-sections-json", "");

  async execute() {
    const { emitReleaseNarrativeDocument } = await import("../../commands/release-emit-narrative-document.ts");
    const {
      assertReleaseNarrativeContract,
      assertReleaseReportContextContract,
    } = await import("../../../../capability-release-reporting/src/release-action-contracts.ts");

    const parsed = parseRequiredReleaseContractPair({
      context: this.context,
      operation: "release emit-narrative-document",
      leftRaw: this.contextRaw,
      leftB64: this.contextB64,
      leftLabel: "context",
      leftValidate: assertReleaseReportContextContract,
      rightRaw: this.narrativeRaw,
      rightB64: this.narrativeB64,
      rightLabel: "narrative",
      rightValidate: assertReleaseNarrativeContract,
    });
    if (!parsed.ok) return 1;

    const parseJsonArray = (raw, label) => {
      const text = String(raw || "").trim();
      if (!text) return [];
      try {
        const parsedValue = JSON.parse(text);
        return Array.isArray(parsedValue) ? parsedValue : [parsedValue];
      } catch (error) {
        this.context.stderr.write(`--${label} must be valid JSON array\n`);
        throw error;
      }
    };

    let taxonomy;
    let tags;
    let topics;
    let internalOnlySections;
    try {
      taxonomy = parseJsonArray(this.taxonomyJson, "taxonomy-json");
      tags = parseJsonArray(this.tagsJson, "tags-json");
      topics = parseJsonArray(this.topicsJson, "topics-json");
      internalOnlySections = parseJsonArray(this.internalOnlySectionsJson, "internal-only-sections-json");
    } catch {
      return 1;
    }

    const parseOptionalBoolean = (value) => {
      const raw = String(value || "").trim().toLowerCase();
      if (!raw) return undefined;
      if (raw === "true") return true;
      if (raw === "false") return false;
      this.context.stderr.write(`boolean flags must be 'true' or 'false' when provided\n`);
      return null;
    };

    const publishable = parseOptionalBoolean(this.publishable);
    if (publishable === null) return 1;
    const containsInternalOnly = parseOptionalBoolean(this.containsInternalOnly);
    if (containsInternalOnly === null) return 1;

    const out = await emitReleaseNarrativeDocument({
      context: parsed.left,
      narrative: parsed.right,
      issueUrl: String(this.issueUrl || "").trim(),
      repoPath: String(this.repoPath || "").trim() || ".",
      outputDir: String(this.outputDir || "").trim(),
      factoryId: String(this.factoryId || "").trim(),
      taxonomy,
      category: String(this.category || "").trim(),
      tags,
      topics,
      publishable,
      containsInternalOnly,
      internalOnlySections,
    });

    this.context.stdout.write(`${JSON.stringify(out)}\n`);
    return 0;
  }
}

export class ReleaseShapingFollowupCommand extends Command {
  static paths = [["release", "example-web-followup"]];

  contextRaw = Option.String("--context", { required: false });
  contextB64 = Option.String("--context-b64", { required: false });
  narrativeRaw = Option.String("--narrative", { required: false });
  narrativeB64 = Option.String("--narrative-b64", { required: false });
  factoryId = Option.String("--factory-id", "");
  repoPath = Option.String("--repo-path", ".");

  async execute() {
    const { runReleaseShapingFollowup } = await import("../../commands/release-example-web-followup.ts");
    const {
      assertReleaseNarrativeContract,
      assertReleaseReportContextContract,
    } = await import("../../../../capability-release-reporting/src/release-action-contracts.ts");

    const parsed = parseRequiredReleaseContractPair({
      context: this.context,
      operation: "release example-web-followup",
      leftRaw: this.contextRaw,
      leftB64: this.contextB64,
      leftLabel: "context",
      leftValidate: assertReleaseReportContextContract,
      rightRaw: this.narrativeRaw,
      rightB64: this.narrativeB64,
      rightLabel: "narrative",
      rightValidate: assertReleaseNarrativeContract,
    });
    if (!parsed.ok) return 1;

    const warnings = [];
    const out = await runReleaseShapingFollowup({
      context: parsed.left,
      narrative: parsed.right,
      factoryId: String(this.factoryId || "").trim(),
      repoPath: String(this.repoPath || "").trim() || ".",
      warnFn(message) {
        warnings.push(String(message || ""));
      },
    });

    for (const warning of warnings) {
      if (warning) this.context.stderr.write(`[warn] ${warning}\n`);
    }

    this.context.stdout.write(`${JSON.stringify(out)}\n`);
    return 0;
  }
}

export const releaseDeliveryCommands = [
  ReleaseBuildSlackBlocksCommand,
  ReleasePostToSlackCommand,
  ReleasePublishReportCommand,
  ReleaseUpdateDedupCursorCommand,
  ReleaseEmitNarrativeDocumentCommand,
  ReleaseShapingFollowupCommand,
];
