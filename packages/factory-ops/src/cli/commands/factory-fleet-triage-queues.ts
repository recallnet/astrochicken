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

function resolveRenderMode({ json = false, format = "" } = {}) {
  const normalized = trim(format).toLowerCase();
  if (json) return "json";
  if (!normalized || normalized === "human" || normalized === "table") return "human";
  if (normalized === "json") return "json";
  return "invalid";
}

function resolveContext(command) {
  return resolveFactoryContextOrExit(command, {
    runsDir: command.runsDir,
    factoryRoot: command.factoryRoot,
    factoryConfigPath: command.factoryConfigPath,
    factoryId: command.factoryId,
    targetRepo: command.repo,
    controlPlaneRepo: command.controlPlaneRepo,
    scenariosRoot: command.scenariosRoot,
  });
}

export class FactoryFleetTriageQueuesCommand extends Command {
  static paths = [["factory", "fleet-triage-queues"]];
  static usage = Command.Usage({
    description: "Project deterministic fleet incident triage queue from run-state metadata.",
  });

  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  lookbackHours = Option.String("--lookback-hours", "24");
  json = Option.Boolean("--json", false);
  format = Option.String("--format", "human");

  async execute() {
    const renderMode = resolveRenderMode({ json: this.json, format: this.format });
    if (renderMode === "invalid") {
      writeStructuredError(this, {
        errorCode: "invalid_format",
        message: `invalid_format:${this.format}`,
      });
      return 2;
    }

    const context = await resolveContext(this);
    if (!context) return 2;

    const {
      factoryFleetTriageQueues,
      formatFleetTriageQueues,
    } = await import("../../commands/factory-fleet-triage-queues.ts");

    const report = factoryFleetTriageQueues({
      context,
      runsDir: this.runsDir,
      lookbackHours: parsePositiveNumber(this.lookbackHours, 24),
    });

    if (renderMode === "json") {
      writeJson(this, report);
    } else {
      this.context.stdout.write(`${formatFleetTriageQueues(report)}\n`);
    }

    if (report?.ok === false) return 1;
    return 0;
  }
}

export const factoryFleetTriageQueuesCommands = [
  FactoryFleetTriageQueuesCommand,
];
