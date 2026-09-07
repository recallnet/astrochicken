import { Command, Option } from "clipanion";

// -- triage normalize-issues --
export class TriageNormalizeIssuesCommand extends Command {
  static paths = [["triage", "normalize-issues"]];
  issueUrlsRaw = Option.String("--issue-urls", "[]");

  async execute() {
    const { normalizeIssueUrls } = await import("../../commands/triage-normalize-issues.ts");
    const out = normalizeIssueUrls(this.issueUrlsRaw);
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- triage zip-features --
export class TriageZipFeaturesCommand extends Command {
  static paths = [["triage", "zip-features"]];
  approvedFeatures = Option.String("--approved-features", "[]");
  issueIndex = Option.String("--issue-index", "[]");

  async execute() {
    const { zipFeaturesToIssues } = await import("../../commands/triage-zip-features.ts");
    const out = zipFeaturesToIssues({
      featuresRaw: this.approvedFeatures,
      issueIndexRaw: this.issueIndex,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- triage apply-status --
export class TriageApplyStatusCommand extends Command {
  static paths = [["triage", "apply-status"]];
  repo = Option.String("--repo", ".");
  issue = Option.String("--issue", "");
  status = Option.String("--status", "");
  blockedBy = Option.String("--blocked-by", "[]");
  notes = Option.String("--notes", "");
  controlPlaneBlocker = Option.String("--control-plane-blocker", "");

  async execute() {
    const { applyTriageStatus } = await import("../../commands/triage-apply-status.ts");
    const out = applyTriageStatus({
      repo: this.repo,
      issueNumber: this.issue,
      status: this.status,
      blockedByRaw: this.blockedBy,
      notes: this.notes,
      controlPlaneBlockerRaw: this.controlPlaneBlocker,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

// -- triage record-relationships --
export class TriageRecordRelationshipsCommand extends Command {
  static paths = [["triage", "record-relationships"]];
  repo = Option.String("--repo", ".");
  issue = Option.String("--issue", "");
  parent = Option.String("--parent", "");
  blocking = Option.String("--blocking", "[]");
  blockedBy = Option.String("--blocked-by", "[]");

  async execute() {
    const { postRelationshipComment } = await import("../../commands/triage-relationships.ts");
    const out = postRelationshipComment({
      repo: this.repo,
      issueNumber: this.issue,
      parentIssue: this.parent,
      blockingIssuesRaw: this.blocking,
      blockedByRaw: this.blockedBy,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- triage sync-blocked-by --
export class TriageSyncBlockedByCommand extends Command {
  static paths = [["triage", "sync-blocked-by"]];
  repo = Option.String("--repo", ".");
  issue = Option.String("--issue", "");
  blockedBy = Option.String("--blocked-by", "[]");

  async execute() {
    const { syncBlockedBy } = await import("../../commands/triage-sync-blocked-by.ts");
    const out = syncBlockedBy({
      repo: this.repo,
      issueNumber: this.issue,
      blockedByRaw: this.blockedBy,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- triage resolve-feature-dependencies --
export class TriageResolveFeatureDependenciesCommand extends Command {
  static paths = [["triage", "resolve-feature-dependencies"]];
  featureIssueMap = Option.String("--feature-issue-map", "[]");
  repo = Option.String("--repo", ".");
  applySync = Option.String("--apply-sync", "true");
  failOnUnresolvedRefs = Option.String("--fail-on-unresolved-refs", "false");

  async execute() {
    const { resolveFeatureDependencies } = await import("../../commands/triage-resolve-feature-dependencies.ts");
    const out = resolveFeatureDependencies({
      featureIssueMapRaw: this.featureIssueMap,
      repo: this.repo,
      applySync: this.applySync,
      failOnUnresolvedRefs: this.failOnUnresolvedRefs,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class TriageApplyDuplicateCommand extends Command {
  static paths = [["triage", "apply-duplicate"]];
  repo = Option.String("--repo", ".");
  issue = Option.String("--issue", "");
  duplicateOf = Option.String("--duplicate-of", "");

  async execute() {
    const { applyTriageDuplicate } = await import("../../commands/triage-apply-terminal-status.ts");
    const out = applyTriageDuplicate({
      repo: this.repo,
      issueNumber: this.issue,
      duplicateOf: this.duplicateOf,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class TriageApplyDeferredCommand extends Command {
  static paths = [["triage", "apply-deferred"]];
  repo = Option.String("--repo", ".");
  issue = Option.String("--issue", "");

  async execute() {
    const { applyTriageDeferred } = await import("../../commands/triage-apply-terminal-status.ts");
    const { readStdin } = await import("../helpers.ts");
    const out = applyTriageDeferred({
      repo: this.repo,
      issueNumber: this.issue,
      notes: await readStdin(),
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class TriageApplyRejectedUpstreamCommand extends Command {
  static paths = [["triage", "apply-rejected-upstream"]];
  repo = Option.String("--repo", ".");
  issue = Option.String("--issue", "");
  blockerRef = Option.String("--blocker-ref", "");

  async execute() {
    const { applyRejectedUpstream } = await import("../../commands/triage-apply-status.ts");
    const out = applyRejectedUpstream({
      repo: this.repo,
      issue: this.issue,
      blockerRef: this.blockerRef,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export const triageCommands = [
  TriageNormalizeIssuesCommand,
  TriageZipFeaturesCommand,
  TriageApplyStatusCommand,
  TriageRecordRelationshipsCommand,
  TriageSyncBlockedByCommand,
  TriageResolveFeatureDependenciesCommand,
  TriageApplyDuplicateCommand,
  TriageApplyDeferredCommand,
  TriageApplyRejectedUpstreamCommand,
];
