import { Command, Option } from "clipanion";

import { resolveFactoryContextOrExit } from "../factory-command-helpers.ts";

export class FactoryScheduledJobsStatusCommand extends Command {
  static paths = [["factory", "scheduled-jobs-status"]];

  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const {
      factoryScheduledJobsStatus,
      formatFactoryScheduledJobsStatus,
    } = await import("../../commands/factory-scheduled-jobs-status.ts");

    const context = await resolveFactoryContextOrExit(this, {
      runsDir: this.runsDir,
      factoryRoot: this.factoryRoot,
      factoryConfigPath: this.factoryConfigPath,
      factoryId: this.factoryId,
      targetRepo: this.repo,
      controlPlaneRepo: this.controlPlaneRepo,
      scenariosRoot: this.scenariosRoot,
    });
    if (!context) return 2;

    const status = factoryScheduledJobsStatus({
      context,
      now: new Date(),
      hostBaseDir: this.hostBaseDir,
    });

    if (this.json) {
      this.context.stdout.write(JSON.stringify(status, null, 2));
    } else {
      this.context.stdout.write(formatFactoryScheduledJobsStatus(status));
    }

    return 0;
  }
}

export const factoryScheduledJobsStatusCommands = [
  FactoryScheduledJobsStatusCommand,
];
