import { Command, Option } from "clipanion";

import { resolveFactoryContextOrExit } from "../factory-command-helpers.ts";

export class PacketListCommand extends Command {
  static paths = [["packet", "list"]];
  state = Option.String("--state", "");
  type = Option.String("--type", "");
  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  json = Option.Boolean("--json", false);
  limit = Option.String("--limit", "20");

  async execute() {
    const { listCanonicalPackets } = await import("../../lib/canonical-packet-projection.ts");
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

    const runsDir = context.runs_dir || ".hatch/runs";
    const desiredState = (this.state || "").trim();
    const desiredType = (this.type || "").trim();
    const maxItems = Math.max(1, Number(this.limit) || 20);

    const entries = (await listCanonicalPackets({
      runsDir,
      context,
      factoryId: context.factory_id || "",
      packetState: desiredState,
      packetTypes: desiredType ? [desiredType] : [],
      durableOnly: false,
      windowMs: 30 * 24 * 60 * 60 * 1000,
      excludeTerminalRuns: true,
    })).slice(0, maxItems);

    if (this.json) {
      this.context.stdout.write(JSON.stringify(entries.map((e) => ({
        packet_id: e.packet?.packet_id || "",
        packet_type: e.packet?.packet_type || "",
        packet_state: e.packet?.packet_state || "",
        created_at: e.packet?.created_at || "",
        run_id: e.run_id || "",
        pipeline: e.packet?.pipeline || "",
        node_id: e.packet?.node_id || "",
        issue_number: e.packet?.issue_number || e.packet?.resource_refs?.issue_number || "",
        branch: e.packet?.branch || e.packet?.resource_refs?.branch || "",
        packet_path: e.packet_path || "",
      })), null, 2) + "\n");
    } else {
      if (entries.length === 0) {
        this.context.stdout.write(desiredState ? `No ${desiredState} packets found.\n` : "No packets found.\n");
      } else {
        const lines = [`${entries.length} packet(s)${desiredState ? ` [state=${desiredState}]` : ""}:\n`];
        for (const e of entries) {
          const p = e.packet || {};
          const refs = typeof p.resource_refs === "object" ? p.resource_refs : {};
          const issue = p.issue_number || refs.issue_number || "";
          const age = formatAge(p.created_at);
          lines.push(
            `  ${pad(p.packet_state || "?", 12)} ${pad(p.packet_type || "?", 30)} run=${e.run_id || "?"} issue=${issue || "-"} age=${age}`,
          );
        }
        this.context.stdout.write(lines.join("\n") + "\n");
      }
    }
    return 0;
  }
}

function pad(s, n) {
  return String(s || "").padEnd(n);
}

function formatAge(isoDate) {
  if (!isoDate) return "?";
  const ms = Date.now() - Date.parse(String(isoDate));
  if (!Number.isFinite(ms) || ms < 0) return "?";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

export const packetCommands = [
  PacketListCommand,
];
