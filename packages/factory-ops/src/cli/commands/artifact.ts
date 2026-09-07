import { Command, Option } from "clipanion";

export class ArtifactIngestCommand extends Command {
  static paths = [["artifact", "ingest"]];
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  sourceRepos = Option.String("--source-repos", "");
  trustedSourceRepos = Option.String("--trusted-source-repos", { required: false });
  trustedFactoryIds = Option.String("--trusted-factory-ids", "");
  max = Option.String("--max", "20");
  dryRun = Option.String("--dry-run", "false");

  async execute() {
    const { ingestArtifactIssues } = await import("../../commands/artifact-ingest.ts");
    const { parseBoolFlag } = await import("../helpers.ts");
    const sourceRepos = this.sourceRepos.split(",").map(x => x.trim()).filter(Boolean);
    const trustedSourceRepos = this.trustedSourceRepos !== undefined
      ? this.trustedSourceRepos.split(",").map(x => x.trim()).filter(Boolean)
      : sourceRepos;
    const trustedFactoryIds = this.trustedFactoryIds.split(",").map(x => x.trim()).filter(Boolean);
    const out = await ingestArtifactIssues({
      controlPlaneRepo: this.controlPlaneRepo,
      sourceRepos,
      trustedSourceRepos,
      trustedFactoryIds,
      max: Number(this.max) || 20,
      dryRun: parseBoolFlag(this.dryRun),
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class ArtifactEmitIssueCommand extends Command {
  static paths = [["artifact", "emit-issue"]];
  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "");
  sourceRepo = Option.String("--source-repo", "");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "");
  node = Option.String("--node", "");
  kind = Option.String("--kind", "blocker");
  summary = Option.String("--summary", "");
  evidence = Option.String("--evidence", "");
  proposedGoalTitle = Option.String("--proposed-goal-title", "");
  proposedGoalBody = Option.String("--proposed-goal-body", "");
  requiredFactoryRelease = Option.String("--required-factory-release", "");

  async execute() {
    const { emitArtifactIssue } = await import("../../commands/artifact-emit-issue.ts");
    const out = await emitArtifactIssue({
      repo: this.repo,
      factoryId: this.factoryId,
      sourceRepo: this.sourceRepo,
      runId: this.runId,
      pipeline: this.pipeline,
      node: this.node,
      kind: this.kind,
      summary: this.summary,
      evidence: this.evidence,
      proposedGoalTitle: this.proposedGoalTitle,
      proposedGoalBody: this.proposedGoalBody,
      requiredFactoryRelease: this.requiredFactoryRelease,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class ArtifactReleaseManifestCommand extends Command {
  static paths = [["artifact", "release-manifest"]];
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  sourceRepos = Option.String("--source-repos", "");
  states = Option.String("--states", "closed");
  max = Option.String("--max", "200");
  runId = Option.String("--run-id", "");
  releaseSha = Option.String("--release-sha", "");
  releaseTag = Option.String("--release-tag", "");
  changelogSummary = Option.String("--changelog-summary", "");
  localFactoryRelease = Option.String("--local-factory-release", "");
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  releasesDir = Option.String("--releases-dir", ".hatch/releases");
  outPath = Option.String("--out-path", "");

  async execute() {
    const { produceReleaseManifest } = await import("../../commands/release-manifest.ts");
    const sourceRepos = this.sourceRepos.split(",").map((x) => x.trim()).filter(Boolean);
    const out = produceReleaseManifest({
      controlPlaneRepo: this.controlPlaneRepo,
      sourceRepos,
      states: this.states,
      max: Number(this.max) || 200,
      runId: this.runId,
      releaseSha: this.releaseSha,
      releaseTag: this.releaseTag,
      changelogSummary: this.changelogSummary,
      localFactoryRelease: this.localFactoryRelease,
      runsDir: this.runsDir,
      releasesDir: this.releasesDir,
      outPath: this.outPath,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class ArtifactEmitDispositionFeedbackCommand extends Command {
  static paths = [["artifact", "emit-disposition-feedback"]];
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  manifestPath = Option.String("--manifest-path", "");
  dryRun = Option.Boolean("--dry-run", false);

  async execute() {
    const { postDispositionFeedback } = await import("../../commands/artifact-feedback.ts");

    if (!this.controlPlaneRepo || !this.manifestPath) {
      this.context.stdout.write(JSON.stringify({
        processed: 0,
        skipped: 0,
        failed: 1,
        entries: [{ ok: false, reason: "missing_args", control_plane_repo: this.controlPlaneRepo, manifest_path: this.manifestPath }],
      }));
      return 1;
    }

    const { readFileSync } = await import("node:fs");

    let manifestRaw = "";
    try {
      manifestRaw = readFileSync(this.manifestPath, "utf8");
    } catch (error) {
      this.context.stdout.write(JSON.stringify({
        processed: 0,
        skipped: 0,
        failed: 1,
        entries: [{ ok: false, reason: "manifest_read_failed", error: String(error?.message || error || "manifest_read_failed") }],
      }));
      return 1;
    }

    let manifest;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      this.context.stdout.write(JSON.stringify({
        processed: 0,
        skipped: 0,
        failed: 1,
        entries: [{ ok: false, reason: "manifest_parse_failed" }],
      }));
      return 1;
    }

    const entries = Array.isArray(manifest)
      ? manifest
      : (Array.isArray(manifest?.entries)
        ? manifest.entries
        : (Array.isArray(manifest?.artifacts) ? manifest.artifacts : []));

    const releaseIdentity = {
      release_id: String(manifest?.release?.release_id || ""),
      release_tag: String(manifest?.release?.tag || ""),
      release_sha: String(manifest?.release?.sha || ""),
    };

    const results = [];
    for (const entry of entries) {
      const disposition = String(entry?.status || entry?.linkage?.status || "").trim().toLowerCase();
      const blockerRef = String(
        entry?.blockerRef
        || entry?.blocker_ref
        || entry?.linkage?.blockerRef
        || entry?.linkage?.blocker_ref
        || "",
      ).trim();

      const out = postDispositionFeedback({
        source_repo: entry?.source_repo,
        source_issue: entry?.source_issue,
        disposition,
        blockerRef,
        releaseIdentity,
        manifestPath: this.manifestPath,
        issueCommentFn: this.dryRun
          ? () => ({ ok: true, stdout: "dry_run", stderr: "", exit_code: 0 })
          : undefined,
        listCommentsFn: this.dryRun
          ? () => ({ ok: true, comments: [] })
          : undefined,
      });

      results.push({
        ...out,
        dry_run: this.dryRun,
        source_repo: String(entry?.source_repo || out?.source_repo || ""),
        source_issue: Number(entry?.source_issue || out?.source_issue || 0),
      });
    }

    const summary = {
      processed: results.length,
      skipped: results.filter((item) => item?.ok && item?.skipped).length,
      failed: results.filter((item) => item?.ok === false && item?.reason !== "already_recorded").length,
      entries: results,
    };

    this.context.stdout.write(JSON.stringify(summary));
    return summary.failed > 0 ? 1 : 0;
  }
}

export class ResearchWriteArtifactCommand extends Command {
  static paths = [["research", "write-artifact"]];
  path = Option.String("--path", "");
  content = Option.String("--content", "");
  metricsPath = Option.String("--metrics-path", "");
  metricsContent = Option.String("--metrics-content", "");
  repoRoot = Option.String("--repo-root", "");

  async execute() {
    const { writeResearchArtifact } = await import("../../commands/research-write-artifact.ts");
    const out = writeResearchArtifact({
      path: this.path,
      content: this.content,
      metricsPath: this.metricsPath,
      metricsContent: this.metricsContent,
      repoRoot: this.repoRoot,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export const artifactCommands = [
  ArtifactIngestCommand,
  ArtifactEmitIssueCommand,
  ArtifactReleaseManifestCommand,
  ArtifactEmitDispositionFeedbackCommand,
  ResearchWriteArtifactCommand,
];
