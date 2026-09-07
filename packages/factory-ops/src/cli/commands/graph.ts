import { Command, Option } from "clipanion";

export class GraphMigrateTrustParticipantsCommand extends Command {
  static paths = [["graph", "migrate-trust-participants"]];
  graphsDir = Option.String("--graphs-dir", "factories/mothership/graphs");
  paths = Option.String("--paths", "");
  write = Option.Boolean("--write", false);
  active = Option.Boolean("--active", false);

  async execute() {
    const { migrateLocalIntentGraphTrustContracts } = await import("../../commands/graph-trust-contract.ts");
    const paths = this.paths.split(",").map(x => x.trim()).filter(Boolean);
    const out = migrateLocalIntentGraphTrustContracts({
      graphsDir: this.graphsDir,
      paths,
      write: this.write,
      activeOnly: this.active,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class GraphCheckTrustParticipantsCommand extends Command {
  static paths = [["graph", "check-trust-participants"]];
  graphsDir = Option.String("--graphs-dir", "factories/mothership/graphs");
  paths = Option.String("--paths", "");
  strict = Option.String("--strict", { required: false });
  active = Option.Boolean("--active", false);

  async execute() {
    const { validateLocalIntentGraphTrustContracts, isStrictTrustContractEnabled } = await import("../../commands/graph-trust-contract.ts");
    const paths = this.paths.split(",").map(x => x.trim()).filter(Boolean);
    const strict = isStrictTrustContractEnabled(this.strict);
    const out = validateLocalIntentGraphTrustContracts({
      graphsDir: this.graphsDir,
      paths,
      strict,
      activeOnly: this.active,
    });
    this.context.stdout.write(JSON.stringify(out));
    if (strict && !out.ok) return 1;
    return 0;
  }
}

export const graphCommands = [
  GraphMigrateTrustParticipantsCommand,
  GraphCheckTrustParticipantsCommand,
];
