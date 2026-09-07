import { Command, Option } from "clipanion";

import { parsePositiveNumber, resolveB64OrRaw } from "../helpers.ts";
import { parseContractValue } from "../release-command-helpers.ts";

export class ReleaseBuildReportContextCommand extends Command {
  static paths = [["release", "build-report-context"]];

  repo = Option.String("--repo", "");
  repoPath = Option.String("--repo-path", ".");
  factoryId = Option.String("--factory-id", "");
  rootDir = Option.String("--root-dir", ".");
  lookbackHours = Option.String("--lookback-hours", "24");
  now = Option.String("--now", "");
  skipDedup = Option.Boolean("--skip-dedup", false);

  async execute() {
    const { buildReleaseReportContext } = await import("../../commands/release-build-report-context.ts");
    const { readReleaseDedupCursor } = await import("../../commands/release-dedup-cursor.ts");
    const { assertReleaseReportContextContract } = await import("../../../../capability-release-reporting/src/release-action-contracts.ts");

    const normalizedRepo = String(this.repo || "").trim();
    if (!normalizedRepo) {
      this.context.stderr.write("--repo is required\n");
      return 1;
    }

    let clock;
    if (String(this.now || "").trim()) {
      const nowMs = Date.parse(String(this.now));
      if (!Number.isFinite(nowMs)) {
        this.context.stderr.write("--now must be a valid ISO-8601 timestamp\n");
        return 1;
      }
      clock = () => new Date(nowMs);
    }

    let dedupCursor = null;
    if (!this.skipDedup && String(this.factoryId || "").trim()) {
      dedupCursor = readReleaseDedupCursor({
        factoryId: this.factoryId,
        rootDir: this.rootDir,
      });
    }

    try {
      const output = await buildReleaseReportContext({
        repo: normalizedRepo,
        repoPath: this.repoPath,
        factoryId: this.factoryId,
        lookbackHours: parsePositiveNumber(this.lookbackHours, 1),
        dedupCursor,
        clock,
      });
      this.context.stdout.write(JSON.stringify(assertReleaseReportContextContract(output), null, 2));
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 1;
    }
  }
}

export class ReleaseCheckNewContentCommand extends Command {
  static paths = [["release", "check-new-content"]];

  contextRaw = Option.String("--context", { required: false });
  contextB64 = Option.String("--context-b64", { required: false });

  async execute() {
    const { assertReleaseReportContextContract } = await import("../../../../capability-release-reporting/src/release-action-contracts.ts");
    let contextPayload;
    try {
      contextPayload = resolveB64OrRaw(this.contextRaw, this.contextB64, "context");
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 1;
    }

    if (!String(contextPayload || "").trim()) {
      this.context.stderr.write("release check-new-content requires --context or --context-b64\n");
      return 1;
    }

    const parsed = parseContractValue({
      context: this.context,
      payload: contextPayload,
      label: "context",
      validate: assertReleaseReportContextContract,
    });
    if (!parsed.ok) return 1;

    const metrics = parsed.value?.metrics || {};
    const goalsCount = Number(metrics.goals_closed) || 0;
    const issuesCount = Number(metrics.issues_closed) || 0;
    const commitsCount = Number(metrics.commits_landed) || 0;
    const hasNew = goalsCount > 0 || issuesCount > 0 || commitsCount > 0;

    this.context.stdout.write(JSON.stringify({
      has_new_content: hasNew ? "true" : "false",
      goals_closed: goalsCount,
      issues_closed: issuesCount,
      commits_landed: commitsCount,
    }));
    return 0;
  }
}

export const releaseContextCommands = [
  ReleaseBuildReportContextCommand,
  ReleaseCheckNewContentCommand,
];
