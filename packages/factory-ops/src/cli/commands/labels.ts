import { Command, Option } from "clipanion";

import {
  buildFactoryLabelSnapshot,
  ensureFactoryLabels,
  getDefaultNormalizationLabelNames,
  listFactoryIdsWithLabelOverlays,
  resolveFactoryLabelContract,
  validateFactoryRepoLabels,
  validateFactoryLabelContract,
} from "../../lib/factory-label-contract.ts";
import { decodeBase64Utf8 } from "../helpers.ts";

export class LabelsNormalizeCommand extends Command {
  static paths = [["labels", "normalize"]];
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "mothership");
  issueLabels = Option.String("--issue-labels", { required: false });
  issueLabelsB64 = Option.String("--issue-labels-b64", { required: false });
  allowed = Option.String("--allowed", "");
  state = Option.String("--state", "open");
  dryRun = Option.Boolean("--dry-run", false);

  async execute() {
    const { readStdin } = await import("../helpers.ts");
    const labelsRaw = this.issueLabelsB64 !== undefined
      ? decodeBase64Utf8(this.issueLabelsB64)
      : (this.issueLabels ?? ((await readStdin()) || undefined));

    if (labelsRaw !== undefined) {
      // Mode 1: single-issue label normalization
      const { normalizeAndEnsureIssueLabels } = await import("../../commands/labels-normalize.ts");
      const out = normalizeAndEnsureIssueLabels({ repo: this.repo, labelsRaw, factoryId: this.factoryId });
      this.context.stdout.write(out);
      return 0;
    }

    // Mode 2: bulk repo-wide label normalization
    const { normalizeIssueLabels } = await import("../../commands/labels-normalize.ts");
    const allowed = this.allowed.split(",").map((x) => x.trim()).filter(Boolean);
    const out = await normalizeIssueLabels({
      repo: this.repo,
      state: this.state,
      dryRun: this.dryRun,
      allowed: allowed.length > 0 ? allowed : getDefaultNormalizationLabelNames(this.factoryId),
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class LabelsEnsureCommand extends Command {
  static paths = [["labels", "ensure"]];
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "mothership");
  keys = Option.String("--keys", "");

  async execute() {
    const requestedKeys = this.keys.split(",").map((value) => value.trim()).filter(Boolean);
    const out = ensureFactoryLabels({
      repo: this.repo,
      factoryId: this.factoryId,
      keys: requestedKeys,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class LabelsContractCommand extends Command {
  static paths = [["labels", "contract"]];
  factoryId = Option.String("--factory-id", "");

  async execute() {
    if (this.factoryId) {
      const contract = resolveFactoryLabelContract(this.factoryId);
      this.context.stdout.write(JSON.stringify({
        schema_version: "factory_label_contract/v1",
        factory_id: contract.factory_id,
        labels: contract.labels,
      }));
      return 0;
    }
    this.context.stdout.write(JSON.stringify(buildFactoryLabelSnapshot()));
    return 0;
  }
}

export class LabelsValidateContractCommand extends Command {
  static paths = [["labels", "validate-contract"]];
  factoryId = Option.String("--factory-id", "");

  async execute() {
    const factoryIds = this.factoryId
      ? [this.factoryId]
      : listFactoryIdsWithLabelOverlays();
    const results = factoryIds.map((factoryId) => validateFactoryLabelContract(factoryId));
    const ok = results.every((result) => result.ok);
    this.context.stdout.write(JSON.stringify({ ok, results }));
    return ok ? 0 : 1;
  }
}

export class LabelsValidateRepoCommand extends Command {
  static paths = [["labels", "validate-repo"]];
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "mothership");

  async execute() {
    const result = validateFactoryRepoLabels({ repo: this.repo, factoryId: this.factoryId });
    this.context.stdout.write(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }
}

export class LabelProvisionCommand extends Command {
  static paths = [["label-provision"], ["labels", "provision"]];
  factoryKind = Option.String("--factory-kind", "");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  dryRun = Option.Boolean("--dry-run", false);

  async execute() {
    const { runLabelProvision } = await import("../../commands/label-provision.ts");
    const result = runLabelProvision({
      factoryKind: this.factoryKind,
      targetRepo: this.targetRepo,
      controlPlaneRepo: this.controlPlaneRepo,
      dryRun: this.dryRun,
    });
    this.context.stdout.write(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }
}

export const labelsCommands = [
  LabelsNormalizeCommand,
  LabelsEnsureCommand,
  LabelsContractCommand,
  LabelsValidateContractCommand,
  LabelsValidateRepoCommand,
  LabelProvisionCommand,
];
