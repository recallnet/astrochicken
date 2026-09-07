import { Command, Option } from "clipanion";

export class ScenarioEnsureStructureCommand extends Command {
  static paths = [["scenario", "ensure-structure"]];
  payload = Option.String("--payload", "{}");

  async execute() {
    const { ensureScenarioStructure } = await import("../../commands/scenario-ensure-structure.ts");
    const out = ensureScenarioStructure(this.payload);
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class ScenarioValidateScopeCommand extends Command {
  static paths = [["scenario", "validate-scope"]];
  payload = Option.String("--payload", "{}");

  async execute() {
    const { validateScenarioScope } = await import("../../commands/scenario-validate-scope.ts");
    const out = validateScenarioScope(this.payload);
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class ScenarioValidatePayloadCommand extends Command {
  static paths = [["scenario", "validate-payload"]];
  payload = Option.String("--payload", "{}");

  async execute() {
    const { validateScenarioPayload } = await import("../../commands/scenario-validate-payload.ts");
    const out = validateScenarioPayload(this.payload);
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class ScenarioSaveCommand extends Command {
  static paths = [["scenario", "save"]];
  payload = Option.String("--payload", "{}");
  registryRoot = Option.String("--registry-root", "");

  async execute() {
    const { saveScenario } = await import("../../commands/scenario-save.ts");
    const out = saveScenario({ payload: this.payload, registryRoot: this.registryRoot });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class ScenarioCountGateCommand extends Command {
  static paths = [["scenario", "count-gate"]];
  registryRoot = Option.String("--registry-root", "factories/mothership/scenarios");
  maxCount = Option.String("--max-count", "30");

  async execute() {
    const { scenarioCountGate } = await import("../../commands/scenario-count-gate.ts");
    const out = scenarioCountGate({
      registryRoot: this.registryRoot,
      maxCount: this.maxCount,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class ScenarioCurateCommand extends Command {
  static paths = [["scenario", "curate"]];
  registryRoot = Option.String("--registry-root", "factories/mothership/scenarios/astrochicken");
  runsRoot = Option.String("--runs-root", ".hatch/runs");
  lookbackRuns = Option.String("--lookback-runs", "30");
  staleDays = Option.String("--stale-days", "90");
  outputJson = Option.Boolean("--output-json", false);

  async execute() {
    const { formatScenarioCurateTable, scenarioCurate } = await import("../../commands/scenario-curate.ts");
    const out = scenarioCurate({
      registryRoot: this.registryRoot,
      runsRoot: this.runsRoot,
      lookbackRuns: this.lookbackRuns,
      staleDays: this.staleDays,
    });

    if (this.outputJson) {
      this.context.stdout.write(JSON.stringify(out, null, 2));
    } else {
      this.context.stdout.write(formatScenarioCurateTable(out));
    }

    return out.ok ? 0 : 1;
  }
}

export class ScenarioAddCommand extends Command {
  static paths = [["scenario", "add"]];
  registryRoot = Option.String("--registry-root", "factories/mothership/scenarios/astrochicken");
  id = Option.String("--id", "");
  domain = Option.String("--domain", "");
  priority = Option.String("--priority", "");
  truth = Option.String("--truth", "");
  created = Option.String("--created", "");

  async execute() {
    const { scenarioAdd } = await import("../../commands/scenario-add.ts");
    const out = scenarioAdd({
      registryRoot: this.registryRoot,
      id: this.id,
      domain: this.domain,
      priority: this.priority,
      truth: this.truth,
      created: this.created,
    });

    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export const scenarioCommands = [
  ScenarioEnsureStructureCommand,
  ScenarioValidateScopeCommand,
  ScenarioValidatePayloadCommand,
  ScenarioSaveCommand,
  ScenarioCountGateCommand,
  ScenarioCurateCommand,
  ScenarioAddCommand,
];
