import { Command, Option } from "clipanion";

export class RetryProfileCommand extends Command {
  static paths = [["retry", "profile"]];
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  last = Option.String("--last", "30");
  format = Option.String("--format", "json");
  pipeline = Option.String("--pipeline", "");
  compare = Option.Boolean("--compare", false);
  baselineLast = Option.String("--baseline-last", { required: false });

  async execute() {
    const { buildRetryProfile, compareRetryProfiles, renderRetryProfileMarkdown, renderRetryCompareMarkdown } = await import("../../commands/retry-profile.ts");
    const last = Number(this.last) || 30;
    const baselineLast = this.baselineLast !== undefined ? (Number(this.baselineLast) || last) : last;
    const isMd = this.format === "md" || this.format === "markdown";

    if (!this.compare) {
      const profile = buildRetryProfile({ runsDir: this.runsDir, last, offset: 0, pipeline: this.pipeline });
      if (isMd) {
        this.context.stdout.write(renderRetryProfileMarkdown(profile));
      } else {
        this.context.stdout.write(JSON.stringify(profile, null, 2));
      }
      return 0;
    }

    const current = buildRetryProfile({ runsDir: this.runsDir, last, offset: 0, pipeline: this.pipeline });
    const baseline = buildRetryProfile({ runsDir: this.runsDir, last: baselineLast, offset: last, pipeline: this.pipeline });
    const out = compareRetryProfiles(current, baseline);
    if (isMd) {
      this.context.stdout.write(renderRetryCompareMarkdown(out));
    } else {
      this.context.stdout.write(JSON.stringify(out, null, 2));
    }
    return 0;
  }
}

export const retryCommands = [
  RetryProfileCommand,
];
