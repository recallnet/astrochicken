import { Command, Option } from "clipanion";

import { resolveFactoryContextOrExit } from "../factory-command-helpers.ts";
import { parsePositiveNumber } from "../helpers.ts";

function trim(value = "") {
  return String(value ?? "").trim();
}

function resolveRenderMode({ json = false, format = "" } = {}) {
  const normalized = trim(format).toLowerCase();
  if (json) return "json";
  if (!normalized) return "human";
  if (normalized === "json") return "json";
  if (normalized === "human" || normalized === "table") return "human";
  return "invalid";
}

function writeJson(command, payload = {}) {
  command.context.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeStructuredError(command, { errorCode = "invalid_args", message = "invalid_args", extra = {} } = {}) {
  const payload = {
    ok: false,
    error_code: trim(errorCode) || "invalid_args",
    message: trim(message) || "invalid_args",
    ...extra,
  };
  command.context.stderr.write(`${payload.message}\n`);
  writeJson(command, payload);
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

export class FactoryTriageQueuesCommand extends Command {
  static paths = [["factory", "triage-queues"]];

  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  registryPath = Option.String("--registry-path", "factory-registry.json");
  mirrorDir = Option.String("--mirror-dir", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  hostRepoRoot = Option.String("--host-repo-root", ".");
  eventLimit = Option.String("--event-limit", "200");
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
      runFleetTriageQueues,
      formatFleetTriageQueuesHuman,
    } = await import("../../commands/factory-fleet-triage.ts");

    const report = await runFleetTriageQueues({
      context,
      registryPath: this.registryPath,
      mirrorDir: this.mirrorDir,
      hostBaseDir: this.hostBaseDir,
      hostRepoRoot: this.hostRepoRoot,
      eventLimit: parsePositiveNumber(this.eventLimit, 200),
    });

    if (renderMode === "json") {
      writeJson(this, report);
    } else {
      this.context.stdout.write(`${formatFleetTriageQueuesHuman(report)}\n`);
    }

    return 0;
  }
}

export class FactoryTriageBlastRadiusCommand extends Command {
  static paths = [["factory", "triage-blast-radius"]];

  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  registryPath = Option.String("--registry-path", "factory-registry.json");
  mirrorDir = Option.String("--mirror-dir", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  hostRepoRoot = Option.String("--host-repo-root", ".");
  eventLimit = Option.String("--event-limit", "200");
  fingerprint = Option.String("--fingerprint", "");
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
      runFleetTriageBlastRadius,
      formatFleetTriageBlastRadiusHuman,
    } = await import("../../commands/factory-fleet-triage.ts");

    const payload = await runFleetTriageBlastRadius({
      context,
      fingerprint: this.fingerprint,
      registryPath: this.registryPath,
      mirrorDir: this.mirrorDir,
      hostBaseDir: this.hostBaseDir,
      hostRepoRoot: this.hostRepoRoot,
      eventLimit: parsePositiveNumber(this.eventLimit, 200),
    });

    if (!payload?.ok) {
      writeStructuredError(this, {
        errorCode: payload?.error_code || "invalid_fingerprint",
        message: payload?.message || "invalid_fingerprint",
        extra: {
          fingerprint: trim(payload?.fingerprint || this.fingerprint),
        },
      });
      return 2;
    }

    if (renderMode === "json") {
      writeJson(this, payload);
    } else {
      this.context.stdout.write(`${formatFleetTriageBlastRadiusHuman(payload)}\n`);
    }

    return 0;
  }
}

export const factoryFleetTriageCommands = [
  FactoryTriageQueuesCommand,
  FactoryTriageBlastRadiusCommand,
];
