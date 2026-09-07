import { Command, Option } from "clipanion";

import { resolveFactoryContextOrExit } from "../factory-command-helpers.ts";
import { parsePositiveNumber } from "../helpers.ts";

function trim(value = "") {
  return String(value ?? "").trim();
}

function formatSnapshotTable(payload = {}) {
  const snapshots = Array.isArray(payload?.snapshots) ? payload.snapshots : [];
  const lines = [
    `Mirror snapshots factory_id=${trim(payload.factory_id) || "(unknown)"} mirror_root=${trim(payload.mirror_root) || "(unknown)"} count=${snapshots.length}`,
  ];

  for (const snapshot of snapshots) {
    lines.push(
      [
        `${trim(snapshot.instance_id) || "(unknown)"}`,
        `state=${trim(snapshot.lifecycle_state) || "(missing)"}`,
        `reason=${trim(snapshot.lifecycle_reason) || "none"}`,
        `state_version=${Number(snapshot.state_version) || 0}`,
        `queue_depth=${Number(snapshot.queue_depth) || 0}`,
        `unresolved=${Number(snapshot.unresolved_actions) || 0}`,
        `updated_at=${trim(snapshot.mirror_updated_at) || ""}`,
      ].join(" "),
    );
  }

  if (snapshots.length === 0) {
    lines.push("(no mirrored snapshots)");
  }

  return lines.join("\n");
}

function formatEventsTable(payload = {}) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const lines = [
    `Mirror events factory_id=${trim(payload.factory_id) || "(unknown)"} mirror_root=${trim(payload.mirror_root) || "(unknown)"} source=${trim(payload.events_path) || "(unknown)"} showing=${events.length}/${Number(payload.total_events) || 0} limit=${Number(payload.limit) || 0}`,
  ];

  for (const event of events) {
    lines.push(
      [
        `${trim(event.ended_at || event.started_at) || "(time-missing)"}`,
        `event=${trim(event.event_type) || "unknown"}`,
        `status=${trim(event.status) || "unknown"}`,
        `instance=${trim(event.instance_id) || ""}`,
        `run=${trim(event.run_id) || ""}`,
        `tick=${trim(event.tick_id) || ""}`,
        `duration_ms=${Number(event.duration_ms) || 0}`,
        `incident=${trim(event.incident_fingerprint) || ""}`,
      ].join(" "),
    );
  }

  if (events.length === 0) {
    lines.push("(no mirrored events)");
  }

  return lines.join("\n");
}

function writeJson(stdout, payload = {}) {
  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeError(command, error, extra = {}) {
  const code = trim(error?.code) || "factory_mirror_read_failed";
  const message = trim(error?.message) || code;
  const payload = {
    ok: false,
    error: code,
    message,
    ...extra,
  };
  command.context.stderr.write(`${message}\n`);
  if (command.json) {
    writeJson(command.context.stdout, payload);
  }
  return 1;
}

async function resolveMirrorContext(command) {
  return resolveFactoryContextOrExit(command, {
    factoryRoot: command.factoryRoot,
    factoryConfigPath: command.factoryConfigPath,
    factoryId: command.factoryId,
    targetRepo: command.repo,
    controlPlaneRepo: command.controlPlaneRepo,
    scenariosRoot: command.scenariosRoot,
  });
}

export class FactoryMirrorSnapshotsCommand extends Command {
  static paths = [["factory-mirror", "snapshots"]];
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  mirrorDir = Option.String("--mirror-dir", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const { readMirroredSnapshot } = await import("../../lib/factory-mirror-reader.ts");
    const context = await resolveMirrorContext(this);
    if (!context) return 2;

    try {
      const payload = readMirroredSnapshot(context.factory_id, {
        context,
        mirrorDir: this.mirrorDir,
      });
      const out = { ok: true, ...payload };

      if (this.json) {
        writeJson(this.context.stdout, out);
      } else {
        this.context.stdout.write(`${formatSnapshotTable(payload)}\n`);
      }
      return 0;
    } catch (error) {
      return writeError(this, error, { factory_id: trim(context.factory_id) });
    }
  }
}

export class FactoryMirrorEventsCommand extends Command {
  static paths = [["factory-mirror", "events"]];
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  mirrorDir = Option.String("--mirror-dir", "");
  json = Option.Boolean("--json", false);
  limit = Option.String("--limit", "20");

  async execute() {
    const { readRecentEvents } = await import("../../lib/factory-mirror-reader.ts");
    const context = await resolveMirrorContext(this);
    if (!context) return 2;

    try {
      const payload = readRecentEvents(context.factory_id, {
        context,
        mirrorDir: this.mirrorDir,
        limit: parsePositiveNumber(this.limit, 20),
      });
      const out = { ok: true, ...payload };

      if (this.json) {
        writeJson(this.context.stdout, out);
      } else {
        this.context.stdout.write(`${formatEventsTable(payload)}\n`);
      }
      return 0;
    } catch (error) {
      return writeError(this, error, { factory_id: trim(context.factory_id) });
    }
  }
}

export const factoryMirrorCommands = [
  FactoryMirrorSnapshotsCommand,
  FactoryMirrorEventsCommand,
];
