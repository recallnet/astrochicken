import { Command, Option } from "clipanion";

import {
  resolveRepoOrExit,
  resolveFactoryContextOrExit,
  resolveHostLifecycleInputs,
  printHostLifecycleJson,
  buildHostLifecycleJson,
  resolveDaemonScriptPath,
  buildHostDaemonEnv,
} from "../factory-command-helpers.ts";
import { parsePositiveNumber, parseBoolFlag } from "../helpers.ts";

export class FactorySessionTailCommand extends Command {
  static paths = [["factory", "session-tail"]];
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  runId = Option.String("--run-id", "");
  lines = Option.String("--lines", "20");
  pollMs = Option.String("--poll-ms", "1000");
  follow = Option.Boolean("--follow", false);

  async execute() {
    const { factorySessionTail } = await import("../../commands/factory-session-tail.ts");
    const out = await factorySessionTail({
      runsDir: this.runsDir,
      runId: this.runId,
      lines: parsePositiveNumber(this.lines, 20),
      pollMs: parsePositiveNumber(this.pollMs, 1000),
      follow: this.follow,
      stdout: this.context.stdout,
    });
    return out.ok ? 0 : 1;
  }
}

export class FactorySessionNodeCommand extends Command {
  static paths = [["factory", "session"]];
  runsDir = Option.String("--runs-dir", ".hatch/runs"); runId = Option.String("--run-id", "");
  node = Option.String("--node", ""); lines = Option.String("--lines", "20");
  pollMs = Option.String("--poll-ms", "1000"); follow = Option.Boolean("--follow", false);

  async execute() {
    if (!this.node) {
      this.context.stderr.write("--node is required. Use --node <node-id> (e.g. resolve_conflict)\n");
      return 1;
    }
    const { factorySessionNode } = await import("../../commands/factory-session-node.ts");
    const out = await factorySessionNode({
      runsDir: this.runsDir, runId: this.runId, node: this.node,
      lines: parsePositiveNumber(this.lines, 20),
      pollMs: parsePositiveNumber(this.pollMs, 1000),
      follow: this.follow, stdout: this.context.stdout,
    });
    return out.ok ? 0 : 1;
  }
}

export class FactorySessionBrowserCommand extends Command {
  static paths = [["factory", "session-browser"]];
  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  lookbackHours = Option.String("--lookback-hours", "24");
  refreshMs = Option.String("--refresh-ms", "2000");

  async execute() {
    const { buildFactorySessionBrowserSnapshot } = await import("../../commands/factory-session-browser.ts");
    const { runFactorySessionBrowserTui } = await import("../factory-session-browser-tui.ts");
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

    await runFactorySessionBrowserTui({
      loadSnapshot: () => buildFactorySessionBrowserSnapshot({
        runsDir: context.runs_dir,
        context,
        lookbackHours: parsePositiveNumber(this.lookbackHours, 24),
      }),
      stdout: this.context.stdout,
      stdin: process.stdin,
      refreshMs: parsePositiveNumber(this.refreshMs, 2000),
    });
    return 0;
  }
}

export class FactorySubscribeCommand extends Command {
  static paths = [["factory", "subscribe"]];
  static usage = Command.Usage({
    description: "Wait for the next meaningful factory event with semantic filtering. mode: both",
  });
  runsDir = Option.String("--runs-dir", ""); factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", ""); factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", ""); controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  eventType = Option.String("--event", "");
  target = Option.String("--target", "");
  graph = Option.String("--graph", "");
  node = Option.String("--node", "");
  runId = Option.String("--run-id", "");
  issue = Option.String("--issue", "");
  milestone = Option.String("--milestone", "");
  family = Option.String("--family", "");
  semanticFamily = Option.String("--semantic-family", "");
  stream = Option.Boolean("--stream", false);
  summaryWindowMinutes = Option.String("--summary-window-minutes", "15");
  timeout = Option.String("--timeout", "1800");

  async execute() {
    const { factorySubscribe } = await import("../../commands/factory-subscribe.ts");
    const context = await resolveFactoryContextOrExit(this, { runsDir: this.runsDir, factoryRoot: this.factoryRoot, factoryConfigPath: this.factoryConfigPath, factoryId: this.factoryId, targetRepo: this.repo, controlPlaneRepo: this.controlPlaneRepo, scenariosRoot: this.scenariosRoot });
    if (!context) return 2;
    let hostStatus = null;
    try {
      const resolved = await resolveHostLifecycleInputs(this, {
        factoryRoot: this.factoryRoot,
        factoryConfigPath: this.factoryConfigPath,
        factoryId: this.factoryId,
        runsDir: this.runsDir,
      });
      if (resolved?.context && resolved?.resolvedPaths) {
        const { hostHealth } = await import("../../commands/factory-host-lifecycle.ts");
        hostStatus = hostHealth({
          factoryId: resolved.context.factory_id,
          pidFile: resolved.resolvedPaths.pidFile,
          runsDir: resolved.resolvedPaths.runsDir,
          logsDir: resolved.resolvedPaths.logsDir,
          paths: resolved.resolvedPaths,
        });
      }
    } catch {
      hostStatus = null;
    }

    const result = await factorySubscribe({
      runsDir: context.runs_dir,
      eventType: this.eventType,
      target: this.target,
      context,
      hostStatus,
      runId: this.runId,
      graph: this.graph,
      node: this.node,
      issue: this.issue,
      milestone: this.milestone,
      family: this.family || this.semanticFamily,
      stream: this.stream,
      summaryWindowMinutes: parseInt(this.summaryWindowMinutes, 10),
      timeoutSec: parseInt(this.timeout, 10),
    });
    return result.timedOut ? 1 : 0;
  }
}

export class FactoryWatchCommand extends Command {
  static paths = [["factory", "watch"]];
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  timeout = Option.String("--timeout", "300");
  stream = Option.Boolean("--stream", false);
  repo = Option.String("--repo", "");
  progressInterval = Option.String("--progress-interval", "60");

  async execute() {
    const { factoryWatch } = await import("../../commands/factory-watch.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    await factoryWatch({
      runsDir: this.runsDir,
      timeoutSec: parseInt(this.timeout, 10),
      stream: this.stream,
      repo,
      progressIntervalSec: parseInt(this.progressInterval, 10),
    });
    return 0;
  }
}

export class FactoryHostInstallCommand extends Command {
  static paths = [["factory", "host-install"]];
  static usage = Command.Usage({
    description: "Install per-factory host runtime paths and manifests. managed-only",
  });
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  logsRoot = Option.String("--logs-root", "");
  runsDir = Option.String("--runs-dir", "");
  tmpDir = Option.String("--tmp-dir", "");
  socketDir = Option.String("--socket-dir", "");
  pidDir = Option.String("--pid-dir", "");

  async execute() {
    const { hostInstall } = await import("../../commands/factory-host-lifecycle.ts");
    const resolved = await resolveHostLifecycleInputs(this, this);
    if (!resolved) return 2;

    const out = hostInstall(resolved.resolvedPaths, resolved.context);
    printHostLifecycleJson(this, buildHostLifecycleJson({
      ok: out.ok,
      status: out.status,
      message: out.message,
      errorCode: out.errorCode,
      context: resolved.context,
      paths: resolved.resolvedPaths,
      pid: out.pid,
      extra: {
        installed_paths: out.installedPaths,
        installation_manifest: out.installationManifest,
      },
    }));
    return out.ok ? 0 : 1;
  }
}

export class FactoryHostStartCommand extends Command {
  static paths = [["factory", "host-start"]];
  static usage = Command.Usage({
    description: "Start the factory daemon via managed host lifecycle controls. managed-only",
  });
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  logsRoot = Option.String("--logs-root", "");
  runsDir = Option.String("--runs-dir", "");
  tmpDir = Option.String("--tmp-dir", "");
  socketDir = Option.String("--socket-dir", "");
  pidDir = Option.String("--pid-dir", "");
  daemonScript = Option.String("--daemon-script", "");
  detach = Option.String("--detach", "true");

  async execute() {
    const { hostStart } = await import("../../commands/factory-host-lifecycle.ts");
    const resolved = await resolveHostLifecycleInputs(this, this);
    if (!resolved) return 2;

    const daemonScript = resolveDaemonScriptPath(resolved.context.factory_root, this.daemonScript);
    const out = await hostStart({
      factoryId: resolved.context.factory_id,
      daemonScript,
      env: buildHostDaemonEnv(resolved.context, resolved.resolvedPaths),
      detach: parseBoolFlag(this.detach, true),
      pidFile: resolved.resolvedPaths.pidFile,
      paths: resolved.resolvedPaths,
    });

    printHostLifecycleJson(this, buildHostLifecycleJson({
      ok: out.ok,
      status: out.status,
      message: out.message,
      errorCode: out.errorCode,
      context: resolved.context,
      paths: resolved.resolvedPaths,
      pid: out.pid,
    }));
    return out.ok ? 0 : 1;
  }
}

export class FactoryHostStopCommand extends Command {
  static paths = [["factory", "host-stop"]];
  static usage = Command.Usage({
    description: "Stop the managed factory daemon for this installation. managed-only",
  });
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  logsRoot = Option.String("--logs-root", "");
  runsDir = Option.String("--runs-dir", "");
  tmpDir = Option.String("--tmp-dir", "");
  socketDir = Option.String("--socket-dir", "");
  pidDir = Option.String("--pid-dir", "");
  signal = Option.String("--signal", "TERM");
  timeoutMs = Option.String("--timeout-ms", "5000");

  async execute() {
    const { hostStop } = await import("../../commands/factory-host-lifecycle.ts");
    const resolved = await resolveHostLifecycleInputs(this, this);
    if (!resolved) return 2;

    const out = await hostStop({
      factoryId: resolved.context.factory_id,
      pidFile: resolved.resolvedPaths.pidFile,
      signal: this.signal,
      timeoutMs: parsePositiveNumber(this.timeoutMs, 5000),
      paths: resolved.resolvedPaths,
    });

    printHostLifecycleJson(this, buildHostLifecycleJson({
      ok: out.ok,
      status: out.status,
      message: out.message,
      errorCode: out.errorCode,
      context: resolved.context,
      paths: resolved.resolvedPaths,
      pid: out.pid,
    }));
    return out.ok ? 0 : 1;
  }
}

export class FactoryHostRestartCommand extends Command {
  static paths = [["factory", "host-restart"]];
  static usage = Command.Usage({
    description: "Restart the managed factory daemon using host lifecycle contract. managed-only",
  });
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  logsRoot = Option.String("--logs-root", "");
  runsDir = Option.String("--runs-dir", "");
  tmpDir = Option.String("--tmp-dir", "");
  socketDir = Option.String("--socket-dir", "");
  pidDir = Option.String("--pid-dir", "");
  daemonScript = Option.String("--daemon-script", "");
  detach = Option.String("--detach", "true");
  signal = Option.String("--signal", "TERM");
  timeoutMs = Option.String("--timeout-ms", "5000");

  async execute() {
    const { hostRestart } = await import("../../commands/factory-host-lifecycle.ts");
    const resolved = await resolveHostLifecycleInputs(this, this);
    if (!resolved) return 2;

    const daemonScript = resolveDaemonScriptPath(resolved.context.factory_root, this.daemonScript);
    const out = await hostRestart({
      factoryId: resolved.context.factory_id,
      daemonScript,
      env: buildHostDaemonEnv(resolved.context, resolved.resolvedPaths),
      detach: parseBoolFlag(this.detach, true),
      pidFile: resolved.resolvedPaths.pidFile,
      signal: this.signal,
      timeoutMs: parsePositiveNumber(this.timeoutMs, 5000),
      paths: resolved.resolvedPaths,
    });

    printHostLifecycleJson(this, buildHostLifecycleJson({
      ok: out.ok,
      status: out.status,
      message: out.message,
      errorCode: out.errorCode,
      context: resolved.context,
      paths: resolved.resolvedPaths,
      pid: out.pid,
      extra: {
        stop_status: out.stopStatus,
        start_status: out.startStatus,
      },
    }));
    return out.ok ? 0 : 1;
  }
}

export class FactoryHostHealthCommand extends Command {
  static paths = [["factory", "host-health"]];
  static usage = Command.Usage({
    description: "Report managed daemon liveness and host-runstate health. managed-only",
  });
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  logsRoot = Option.String("--logs-root", "");
  runsDir = Option.String("--runs-dir", "");
  tmpDir = Option.String("--tmp-dir", "");
  socketDir = Option.String("--socket-dir", "");
  pidDir = Option.String("--pid-dir", "");

  async execute() {
    const { hostHealth } = await import("../../commands/factory-host-lifecycle.ts");
    const resolved = await resolveHostLifecycleInputs(this, this);
    if (!resolved) return 2;

    const out = hostHealth({
      factoryId: resolved.context.factory_id,
      pidFile: resolved.resolvedPaths.pidFile,
      runsDir: resolved.resolvedPaths.runsDir,
      logsDir: resolved.resolvedPaths.logsDir,
      paths: resolved.resolvedPaths,
    });

    printHostLifecycleJson(this, buildHostLifecycleJson({
      ok: out.ok,
      status: out.status,
      message: out.message,
      errorCode: out.errorCode,
      context: resolved.context,
      paths: resolved.resolvedPaths,
      pid: out.pid,
      extra: {
        running: out.running,
        log_file: out.logFile,
        log_exists: out.logExists,
        run_count: out.runCount,
      },
    }));
    return out.ok ? 0 : 1;
  }
}

export class FactoryHostVersionCommand extends Command {
  static paths = [["factory", "host-version"]];
  static usage = Command.Usage({
    description: "Inspect managed host runtime version metadata for this factory. managed-only",
  });
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  logsRoot = Option.String("--logs-root", "");
  runsDir = Option.String("--runs-dir", "");
  tmpDir = Option.String("--tmp-dir", "");
  socketDir = Option.String("--socket-dir", "");
  pidDir = Option.String("--pid-dir", "");

  async execute() {
    const { hostVersion } = await import("../../commands/factory-host-lifecycle.ts");
    const resolved = await resolveHostLifecycleInputs(this, this);
    if (!resolved) return 2;

    const out = hostVersion({
      factoryRoot: resolved.context.factory_root,
      factoryId: resolved.context.factory_id,
      paths: resolved.resolvedPaths,
    });

    printHostLifecycleJson(this, buildHostLifecycleJson({
      ok: out.ok,
      status: out.status,
      message: out.message,
      errorCode: out.errorCode,
      context: resolved.context,
      paths: resolved.resolvedPaths,
      version: out.version,
      extra: {
        source: out.source,
      },
    }));
    return out.ok ? 0 : 1;
  }
}

export class FactoryHostLogsCommand extends Command {
  static paths = [["factory", "host-logs"]];
  static usage = Command.Usage({
    description: "Read managed host daemon logs within retention policy. managed-only",
  });
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  logsRoot = Option.String("--logs-root", "");
  runsDir = Option.String("--runs-dir", "");
  tmpDir = Option.String("--tmp-dir", "");
  socketDir = Option.String("--socket-dir", "");
  pidDir = Option.String("--pid-dir", "");
  tail = Option.String("--tail", "100");
  sinceDuration = Option.String("--since-duration", "");

  async execute() {
    const { hostLogs } = await import("../../commands/factory-host-lifecycle.ts");
    const resolved = await resolveHostLifecycleInputs(this, this);
    if (!resolved) return 2;

    const out = hostLogs({
      factoryId: resolved.context.factory_id,
      logsDir: resolved.resolvedPaths.logsDir,
      tailLines: parsePositiveNumber(this.tail, 100),
      sinceDuration: this.sinceDuration,
      paths: resolved.resolvedPaths,
    });

    printHostLifecycleJson(this, buildHostLifecycleJson({
      ok: out.ok,
      status: out.status,
      message: out.message,
      errorCode: out.errorCode,
      context: resolved.context,
      paths: resolved.resolvedPaths,
      extra: {
        files: out.files,
        lines: out.lines,
        since_duration: out.sinceDuration,
        logs_policy_hint: out.logsPolicyHint,
      },
    }));
    return out.ok ? 0 : 1;
  }
}

export class FactoryHostAssignCommand extends Command {
  static paths = [["factory", "host-assign"]];
  static usage = Command.Usage({
    description: "Assign managed host ownership for a factory installation. managed-only",
  });
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  logsRoot = Option.String("--logs-root", "");
  runsDir = Option.String("--runs-dir", "");
  tmpDir = Option.String("--tmp-dir", "");
  socketDir = Option.String("--socket-dir", "");
  pidDir = Option.String("--pid-dir", "");
  daemonScript = Option.String("--daemon-script", "");
  hostId = Option.String("--host-id", "");
  leaseTtl = Option.String("--lease-ttl", "600");
  registryPath = Option.String("--registry-path", "factory-registry.json");
  installationManifestPath = Option.String("--installation-manifest-path", "");

  async execute() {
    const { assignHostToInstance } = await import("../../commands/factory-host-assignment.ts");
    const resolved = await resolveHostLifecycleInputs(this, this);
    if (!resolved) return 2;

    const explicitHostId = String(this.hostId || "").trim();
    if (explicitHostId) {
      process.env.HATCH_HOST_ID = explicitHostId;
    }

    try {
      const out = assignHostToInstance({
        context: resolved.context,
        paths: resolved.resolvedPaths,
        hostId: explicitHostId,
        instanceId: resolved.context.instance_id || resolved.context.factory_id,
        installationManifestPath: this.installationManifestPath || resolved.resolvedPaths.installationManifestPath,
        registryPath: this.registryPath,
        leaseTtlSec: parsePositiveNumber(this.leaseTtl, 600),
      });

      printHostLifecycleJson(this, buildHostLifecycleJson({
        ok: out.ok,
        status: out.status,
        message: out.status,
        context: resolved.context,
        paths: resolved.resolvedPaths,
        extra: {
          assigned_host_id: out.assigned_host_id,
          lease: out.lease,
          lease_record_path: out.lease_record_path,
          registry_path: out.registry_path,
        },
      }));
      return out.ok ? 0 : 1;
    } catch (error) {
      const { normalizeFactoryOpsError } = await import("../../lib/error-catalog.ts");
      const normalized = normalizeFactoryOpsError(error, "ambiguous_host_assignment");
      printHostLifecycleJson(this, buildHostLifecycleJson({
        ok: false,
        status: "assignment_failed",
        message: normalized.message,
        errorCode: normalized.code,
        context: resolved.context,
        paths: resolved.resolvedPaths,
      }));
      this.context.stderr.write(`${normalized.message}\n`);
      return 1;
    }
  }
}

export class FactoryHostMigrateCommand extends Command {
  static paths = [["factory", "host", "migrate"], ["factory", "host-migrate"]];
  static usage = Command.Usage({
    description: "Migrate managed host assignment between hosts for one installation. managed-only",
  });
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  logsRoot = Option.String("--logs-root", "");
  runsDir = Option.String("--runs-dir", "");
  tmpDir = Option.String("--tmp-dir", "");
  socketDir = Option.String("--socket-dir", "");
  pidDir = Option.String("--pid-dir", "");
  fromHostId = Option.String("--from-host-id", "");
  toHostId = Option.String("--to-host-id", "");
  leaseTtl = Option.String("--lease-ttl", "600");
  drainLeaseTtl = Option.String("--drain-lease-ttl", "15");
  registryPath = Option.String("--registry-path", "factory-registry.json");
  installationManifestPath = Option.String("--installation-manifest-path", "");

  async execute() {
    const { migrateHostAssignment } = await import("../../commands/factory-host-assignment.ts");
    const resolved = await resolveHostLifecycleInputs(this, this);
    if (!resolved) return 2;

    try {
      const out = migrateHostAssignment({
        context: resolved.context,
        paths: resolved.resolvedPaths,
        instanceId: resolved.context.instance_id || resolved.context.factory_id,
        fromHostId: this.fromHostId,
        toHostId: this.toHostId,
        installationManifestPath: this.installationManifestPath || resolved.resolvedPaths.installationManifestPath,
        registryPath: this.registryPath,
        leaseTtlSec: parsePositiveNumber(this.leaseTtl, 600),
        drainLeaseTtlSec: parsePositiveNumber(this.drainLeaseTtl, 15),
      });

      printHostLifecycleJson(this, buildHostLifecycleJson({
        ok: out.ok,
        status: out.status,
        message: out.status,
        context: resolved.context,
        paths: resolved.resolvedPaths,
        extra: {
          from_host_id: out.from_host_id,
          to_host_id: out.to_host_id,
          previous_lease: out.previous_lease,
          lease: out.lease,
          previous_lease_record_path: out.previous_lease_record_path,
          lease_record_path: out.lease_record_path,
          previous_installation_manifest_path: out.previous_installation_manifest_path,
          installation_manifest_path: out.installation_manifest_path,
          registry_path: out.registry_path,
        },
      }));
      return out.ok ? 0 : 1;
    } catch (error) {
      const { normalizeFactoryOpsError, FACTORY_OPS_ERROR_CODES } = await import("../../lib/error-catalog.ts");
      const normalized = normalizeFactoryOpsError(error, FACTORY_OPS_ERROR_CODES.ambiguous_host_assignment);
      printHostLifecycleJson(this, buildHostLifecycleJson({
        ok: false,
        status: "migration_failed",
        message: normalized.message,
        errorCode: normalized.code,
        context: resolved.context,
        paths: resolved.resolvedPaths,
      }));
      this.context.stderr.write(`${normalized.message}\n`);
      return 1;
    }
  }
}

export class FactoryHostDrainCommand extends Command {
  static paths = [["factory", "host", "drain"], ["factory", "host-drain"]];
  static usage = Command.Usage({
    description: "Drain managed host lease ownership for temporary maintenance windows. managed-only",
  });
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  logsRoot = Option.String("--logs-root", "");
  runsDir = Option.String("--runs-dir", "");
  tmpDir = Option.String("--tmp-dir", "");
  socketDir = Option.String("--socket-dir", "");
  pidDir = Option.String("--pid-dir", "");
  hostId = Option.String("--host-id", "");
  leaseTtl = Option.String("--lease-ttl", "15");
  registryPath = Option.String("--registry-path", "factory-registry.json");
  installationManifestPath = Option.String("--installation-manifest-path", "");

  async execute() {
    const { drainHostAssignment } = await import("../../commands/factory-host-assignment.ts");
    const resolved = await resolveHostLifecycleInputs(this, this);
    if (!resolved) return 2;

    try {
      const out = drainHostAssignment({
        context: resolved.context,
        paths: resolved.resolvedPaths,
        hostId: this.hostId,
        instanceId: resolved.context.instance_id || resolved.context.factory_id,
        installationManifestPath: this.installationManifestPath || resolved.resolvedPaths.installationManifestPath,
        registryPath: this.registryPath,
        leaseTtlSec: parsePositiveNumber(this.leaseTtl, 15),
      });

      printHostLifecycleJson(this, buildHostLifecycleJson({
        ok: out.ok,
        status: out.status,
        message: out.status,
        context: resolved.context,
        paths: resolved.resolvedPaths,
        extra: {
          assigned_host_id: out.assigned_host_id,
          previous_lease: out.previous_lease,
          lease: out.lease,
          lease_record_path: out.lease_record_path,
          registry_path: out.registry_path,
        },
      }));
      return out.ok ? 0 : 1;
    } catch (error) {
      const { normalizeFactoryOpsError, FACTORY_OPS_ERROR_CODES } = await import("../../lib/error-catalog.ts");
      const normalized = normalizeFactoryOpsError(error, FACTORY_OPS_ERROR_CODES.ambiguous_host_assignment);
      printHostLifecycleJson(this, buildHostLifecycleJson({
        ok: false,
        status: "drain_failed",
        message: normalized.message,
        errorCode: normalized.code,
        context: resolved.context,
        paths: resolved.resolvedPaths,
      }));
      this.context.stderr.write(`${normalized.message}\n`);
      return 1;
    }
  }
}

export class FactoryHostAssignmentStatusCommand extends Command {
  static paths = [["factory", "host-assignment-status"]];
  static usage = Command.Usage({
    description: "Inspect managed host-assignment state without mutating leases. managed-only",
  });
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  logsRoot = Option.String("--logs-root", "");
  runsDir = Option.String("--runs-dir", "");
  tmpDir = Option.String("--tmp-dir", "");
  socketDir = Option.String("--socket-dir", "");
  pidDir = Option.String("--pid-dir", "");
  registryPath = Option.String("--registry-path", "factory-registry.json");
  installationManifestPath = Option.String("--installation-manifest-path", "");

  async execute() {
    const { describeHostAssignment } = await import("../../commands/factory-host-assignment.ts");
    const resolved = await resolveHostLifecycleInputs(this, this);
    if (!resolved) return 2;

    try {
      const out = describeHostAssignment({
        context: resolved.context,
        paths: resolved.resolvedPaths,
        instanceId: resolved.context.instance_id || resolved.context.factory_id,
        installationManifestPath: this.installationManifestPath || resolved.resolvedPaths.installationManifestPath,
        registryPath: this.registryPath,
      });

      printHostLifecycleJson(this, buildHostLifecycleJson({
        ok: out.ok,
        status: out.status,
        message: out.status,
        context: resolved.context,
        paths: resolved.resolvedPaths,
        extra: {
          assigned_host_id: out.assigned_host_id,
          lease: out.lease,
          lease_present: out.lease_present,
          lease_record_path: out.lease_record_path,
          registry_path: out.registry_path,
          read_only: out.read_only,
        },
      }));
      return out.ok ? 0 : 1;
    } catch (error) {
      const { normalizeFactoryOpsError } = await import("../../lib/error-catalog.ts");
      const normalized = normalizeFactoryOpsError(error, "host_assignment_manifest_missing");
      printHostLifecycleJson(this, buildHostLifecycleJson({
        ok: false,
        status: "assignment_status_failed",
        message: normalized.message,
        errorCode: normalized.code,
        context: resolved.context,
        paths: resolved.resolvedPaths,
      }));
      this.context.stderr.write(`${normalized.message}\n`);
      return 1;
    }
  }
}

export class FactoryProvisionRepoCommand extends Command {
  static paths = [["factory", "provision-repo"]];
  instanceId = Option.String("--instance-id", "");
  dryRun = Option.Boolean("--dry-run", false);
  registryPath = Option.String("--registry-path", "factory-registry.json");
  repoRoot = Option.String("--repo-root", process.cwd());
  targetRepoPath = Option.String("--target-repo-path", "");
  instancePath = Option.String("--instance-path", ".hatch/instance.json");

  async execute() {
    const { normalizeFactoryOpsError, FACTORY_OPS_ERROR_CODES } = await import("../../lib/error-catalog.ts");
    const { provisionFactoryRepo } = await import("../../commands/factory-provision-repo.ts");

    try {
      const out = provisionFactoryRepo({
        instanceId: this.instanceId,
        registryPath: this.registryPath,
        repoRoot: this.repoRoot,
        targetRepoPath: this.targetRepoPath,
        instancePath: this.instancePath,
        dryRun: this.dryRun,
      });
      this.context.stdout.write(JSON.stringify(out));
      return out.ok ? 0 : 1;
    } catch (error) {
      const normalized = normalizeFactoryOpsError(error, FACTORY_OPS_ERROR_CODES.host_assignment_registry_missing);
      const payload = {
        schema: "factory.provision_repo.report.v1",
        ok: false,
        status: "failed",
        error_code: normalized.code,
        message: normalized.message,
        instance_id: String(this.instanceId || "").trim(),
        dry_run: this.dryRun,
      };
      this.context.stderr.write(`${normalized.message}\n`);
      this.context.stdout.write(JSON.stringify(payload));
      return 1;
    }
  }
}

export class FactoryProvisioningDriftCommand extends Command {
  static paths = [["factory", "provisioning-drift"]];
  instanceId = Option.String("--instance-id", "");
  all = Option.Boolean("--all", false);
  json = Option.Boolean("--json", false);
  registryPath = Option.String("--registry-path", "factory-registry.json");
  repoRoot = Option.String("--repo-root", process.cwd());
  targetRepoPath = Option.String("--target-repo-path", "");
  targetRepoMapJsonPath = Option.String("--target-repo-map-json", "");
  labelsJsonPath = Option.String("--labels-json-path", "");
  instancePath = Option.String("--instance-path", ".hatch/instance.json");

  async execute() {
    const {
      factoryProvisioningDrift,
      formatProvisioningDriftSummary,
    } = await import("../../commands/factory-provisioning-drift.ts");

    const out = factoryProvisioningDrift({
      instanceId: this.instanceId,
      all: this.all,
      registryPath: this.registryPath,
      repoRoot: this.repoRoot,
      targetRepoPath: this.targetRepoPath,
      targetRepoMapJsonPath: this.targetRepoMapJsonPath,
      labelsJsonPath: this.labelsJsonPath,
      instancePath: this.instancePath,
    });

    if (this.json) {
      this.context.stdout.write(JSON.stringify(out));
    } else {
      this.context.stdout.write(`${formatProvisioningDriftSummary(out)}\n`);
    }

    return out.ok ? 0 : 1;
  }
}

export class FactoryTargetRepoBootstrapCommand extends Command {
  static paths = [["factory", "target-repo", "bootstrap"]];
  targetRepo = Option.String("--target-repo", "");
  instancePath = Option.String("--instance-path", "");
  dryRun = Option.Boolean("--dry-run", false);

  async execute() {
    const { bootstrapFactoryTargetRepo } = await import("../../commands/factory-target-repo-bootstrap.ts");
    const out = bootstrapFactoryTargetRepo({
      targetRepo: this.targetRepo,
      instancePath: this.instancePath,
      dryRun: this.dryRun,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class FactoryRunInspectCommand extends Command {
  static paths = [["factory", "run-inspect"]];
  static usage = Command.Usage({
    description: "Inspect a single run: state, diagnosis, recent transitions, and artifacts.",
  });
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  runId = Option.String("--run-id", "");
  maxEvents = Option.String("--max-events", "10");
  json = Option.Boolean("--json", false);

  async execute() {
    if (!this.runId) {
      this.context.stderr.write("--run-id is required\n");
      return 1;
    }
    const { buildRunInspectionProjection, formatRunInspection } = await import("../../lib/run-inspection.ts");
    const projection = buildRunInspectionProjection({
      runsDir: this.runsDir,
      runId: this.runId,
      maxEvents: parsePositiveNumber(this.maxEvents, 10),
    });
    if (this.json) {
      this.context.stdout.write(JSON.stringify(projection, null, 2) + "\n");
    } else {
      this.context.stdout.write(formatRunInspection(projection) + "\n");
    }
    return 0;
  }
}

export class FactoryTargetRepoValidateCommand extends Command {
  static paths = [["factory", "target-repo", "validate"]];
  targetRepo = Option.String("--target-repo", "");
  instancePath = Option.String("--instance-path", "");
  issueTemplatesDir = Option.String("--issue-templates-dir", "");
  json = Option.Boolean("--json", false);
  summary = Option.Boolean("--summary", false);

  async execute() {
    const {
      validateFactoryTargetRepo,
      formatFactoryTargetRepoValidationSummary,
    } = await import("../../commands/factory-target-repo-validate.ts");

    const out = validateFactoryTargetRepo({
      targetRepo: this.targetRepo,
      instancePath: this.instancePath,
      issueTemplatesDir: this.issueTemplatesDir,
    });

    if (!this.summary || this.json) {
      this.context.stdout.write(JSON.stringify(out));
    } else {
      this.context.stdout.write(`${formatFactoryTargetRepoValidationSummary(out)}\n`);
    }

    return out.ok ? 0 : 1;
  }
}

export const factoryHostCommands = [
  FactorySessionTailCommand,
  FactorySessionNodeCommand,
  FactorySessionBrowserCommand,
  FactorySubscribeCommand,
  FactoryWatchCommand,
  FactoryHostInstallCommand,
  FactoryHostStartCommand,
  FactoryHostStopCommand,
  FactoryHostRestartCommand,
  FactoryHostHealthCommand,
  FactoryHostVersionCommand,
  FactoryHostLogsCommand,
  FactoryHostAssignCommand,
  FactoryHostMigrateCommand,
  FactoryHostDrainCommand,
  FactoryHostAssignmentStatusCommand,
  FactoryProvisionRepoCommand,
  FactoryProvisioningDriftCommand,
  FactoryTargetRepoBootstrapCommand,
  FactoryTargetRepoValidateCommand,
  FactoryRunInspectCommand,
];
