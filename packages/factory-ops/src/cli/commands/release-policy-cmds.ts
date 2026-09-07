import { Command, Option } from "clipanion";

import { parsePolicyInput } from "../release-command-helpers.ts";

export class ReleaseValidatePolicyCommand extends Command {
  static paths = [["release", "validate-policy"]];

  policyPath = Option.String("--policy-path", "");
  policyJson = Option.String("--policy-json", "");

  async execute() {
    const [{ validateResumePolicy }, { readFileSync }] = await Promise.all([
      import("../../lib/resume-policy-schema.ts"),
      import("node:fs"),
    ]);

    let policy;
    try {
      policy = parsePolicyInput({
        policyPath: this.policyPath,
        policyJson: this.policyJson,
        readFileSyncFn: readFileSync,
      });
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 1;
    }

    const validation = validateResumePolicy(policy);
    if (validation.ok) {
      this.context.stdout.write("ok\n");
      return 0;
    }

    for (const error of (Array.isArray(validation.errors) ? validation.errors : [])) {
      this.context.stderr.write(`${String(error)}\n`);
    }
    return 1;
  }
}

export class ReleaseRolloutEventsCommand extends Command {
  static paths = [["release", "rollout-events"]];

  manifestPath = Option.String("--manifest-path", "");
  manifestFetchCmd = Option.String("--manifest-fetch-cmd", "");
  manifestRef = Option.String("--manifest-ref", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  rolloutChannel = Option.String("--rollout-channel", "stable");
  json = Option.Boolean("--json", false);

  async execute() {
    const { readRolloutEventLog } = await import("../../commands/release-rollout-controller-state.ts");

    let events;
    try {
      events = await readRolloutEventLog({
        manifestPath: this.manifestPath,
        manifestFetchCmd: this.manifestFetchCmd,
        manifestRef: this.manifestRef,
        controlPlaneRepo: this.controlPlaneRepo,
        rolloutChannel: this.rolloutChannel,
      });
    } catch (error) {
      this.context.stderr.write(`release rollout-events failed: ${String(error?.message || error)}\n`);
      return 1;
    }

    if (this.json) {
      this.context.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
      return 0;
    }

    if (!Array.isArray(events) || events.length === 0) {
      this.context.stdout.write("No rollout events\n");
      return 0;
    }

    for (const event of events) {
      const at = String(event?.at || "").trim() || "(unknown)";
      const action = String(event?.action || "").trim() || "(none)";
      const channel = String(event?.channel || "").trim() || "(none)";
      const status = String(event?.status || "").trim() || "(none)";
      const reason = String(event?.reason || "").trim() || "(none)";
      const releaseId = String(event?.release_id || "").trim() || "(none)";
      this.context.stdout.write(`${at}  action=${action}  channel=${channel}  status=${status}  reason=${reason}  release_id=${releaseId}\n`);
    }

    return 0;
  }
}

export class ReleaseComprehensionCatchupCommand extends Command {
  static paths = [["release", "comprehension-catchup"]];

  repo = Option.String("--repo", "");
  lookbackDays = Option.String("--lookback-days", "14");
  limit = Option.String("--limit", "5");
  outDir = Option.String("--out-dir", "reports/comprehension");

  async execute() {
    const { runReleaseComprehensionCatchup } = await import("../../commands/release-comprehension-catchup.ts");

    try {
      const out = await runReleaseComprehensionCatchup({
        repo: String(this.repo || "").trim(),
        lookbackDays: this.lookbackDays,
        limit: this.limit,
        outDir: String(this.outDir || "").trim(),
      });
      this.context.stdout.write(`${JSON.stringify(out)}\n`);
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 1;
    }
  }
}

export const releasePolicyCommands = [
  ReleaseValidatePolicyCommand,
  ReleaseRolloutEventsCommand,
  ReleaseComprehensionCatchupCommand,
];
