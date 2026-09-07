import { Command, Option } from "clipanion";

export class GovernanceSanitizeOverlapCommand extends Command {
  static paths = [["governance", "sanitize-overlap"]];
  repo = Option.String("--repo", "");
  dryRun = Option.Boolean("--dry-run", false);
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "");

  async execute() {
    const { sanitizeGovernanceOverlap } = await import("../../commands/governance-sanitize-overlap.ts");
    const out = sanitizeGovernanceOverlap({
      repo: this.repo,
      dryRun: this.dryRun,
      runId: this.runId,
      pipeline: this.pipeline,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export const governanceCommands = [
  GovernanceSanitizeOverlapCommand,
];
