import { Command, Option } from "clipanion";

import { resolveFactoryContextOrExit } from "../factory-command-helpers.ts";
import { parsePositiveNumber } from "../helpers.ts";

function trim(value = "") {
  return String(value ?? "").trim();
}

function writeJson(command, payload = {}) {
  command.context.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeStructuredError(command, { errorCode = "invalid_args", message = "invalid_args" } = {}) {
  const payload = {
    ok: false,
    error_code: trim(errorCode) || "invalid_args",
    message: trim(message) || "invalid_args",
  };
  command.context.stderr.write(`${payload.message}\n`);
  writeJson(command, payload);
}

export class FleetReportCommand extends Command {
  static paths = [["fleet", "report"]];
  static usage = Command.Usage({
    description: "Generate deterministic fleet analytics views from mirrored events and snapshots.",
  });

  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");

  view = Option.String("--view", "");
  instance = Option.String("--instance", "");
  from = Option.String("--from", "");
  to = Option.String("--to", "");
  profile = Option.String("--profile", "");
  registryPath = Option.String("--registry-path", "factory-registry.json");
  mirrorDir = Option.String("--mirror-dir", "");
  eventLimit = Option.String("--event-limit", "500");
  hostBaseDir = Option.String("--host-base-dir", "");
  hostRepoRoot = Option.String("--host-repo-root", ".");
  json = Option.Boolean("--json", false);

  async execute() {
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

    const normalizedView = trim(this.view);
    if (!normalizedView) {
      writeStructuredError(this, {
        errorCode: "missing_view",
        message: "fleet report requires --view",
      });
      return 2;
    }

    const {
      FLEET_REPORT_VIEWS,
      fleetReport,
      formatFleetReportHuman,
    } = await import("../../commands/fleet-report.ts");

    if (!FLEET_REPORT_VIEWS.includes(normalizedView)) {
      writeStructuredError(this, {
        errorCode: "invalid_view",
        message: `invalid_view:${normalizedView}`,
      });
      return 2;
    }

    let report;
    try {
      report = await fleetReport({
        view: normalizedView,
        context,
        factoryId: trim(this.factoryId) || trim(context.factory_id),
        instance: this.instance,
        profile: this.profile,
        from: this.from,
        to: this.to,
        registryPath: this.registryPath,
        mirrorDir: this.mirrorDir,
        rootDir: process.cwd(),
        eventLimit: parsePositiveNumber(this.eventLimit, 500),
        hostBaseDir: this.hostBaseDir,
        hostRepoRoot: this.hostRepoRoot,
      });
    } catch (error) {
      writeStructuredError(this, {
        errorCode: "fleet_report_failed",
        message: String(error?.message || error || "fleet_report_failed"),
      });
      return 1;
    }

    if (this.json) {
      writeJson(this, report);
    } else {
      this.context.stdout.write(`${formatFleetReportHuman(report)}\n`);
    }

    return 0;
  }
}

export const fleetCommands = [
  FleetReportCommand,
];
