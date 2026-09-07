import { Command, Option } from "clipanion";

export class ObservabilityTraceArtifactCommand extends Command {
  static paths = [["observability", "trace-artifact"]];
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  sourceRepo = Option.String("--source-repo", "");
  sourceIssue = Option.String("--source-issue", "0");

  async execute() {
    const { traceArtifactLifecycle } = await import("../../commands/observability-trace.ts");
    const out = traceArtifactLifecycle({
      controlPlaneRepo: this.controlPlaneRepo,
      sourceRepo: this.sourceRepo,
      sourceIssueNumber: Number(this.sourceIssue) || 0,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export const observabilityCommands = [
  ObservabilityTraceArtifactCommand,
];
