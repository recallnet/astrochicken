import { Command, Option } from "clipanion";

export class LlmRouteListCommand extends Command {
  static paths = [["llm", "route", "list"]];
  repoRoot = Option.String("--repo-root", ".");
  inventoryPath = Option.String("--inventory-path", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const {
      buildLlmRouteManifest,
      loadLlmRouteInventory,
      renderLlmRouteList,
    } = await import("../../commands/llm-route-manifest.ts");

    const { resolvedPath, inventory } = loadLlmRouteInventory({
      repoRoot: this.repoRoot,
      inventoryPath: this.inventoryPath,
    });
    const manifest = buildLlmRouteManifest(inventory, resolvedPath);
    this.context.stdout.write(this.json ? `${JSON.stringify(manifest)}\n` : `${renderLlmRouteList(manifest)}\n`);
    return 0;
  }
}

export class LlmRouteInspectCommand extends Command {
  static paths = [["llm", "route", "inspect"]];
  llmPathId = Option.String("--path-id", "");
  repoRoot = Option.String("--repo-root", ".");
  inventoryPath = Option.String("--inventory-path", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const {
      buildLlmRouteManifest,
      inspectLlmRoute,
      loadLlmRouteInventory,
      renderLlmRouteInspect,
    } = await import("../../commands/llm-route-manifest.ts");

    try {
      const { resolvedPath, inventory } = loadLlmRouteInventory({
        repoRoot: this.repoRoot,
        inventoryPath: this.inventoryPath,
      });
      const manifest = buildLlmRouteManifest(inventory, resolvedPath);
      const route = inspectLlmRoute(manifest, this.llmPathId);
      this.context.stdout.write(this.json ? `${JSON.stringify(route)}\n` : `${renderLlmRouteInspect(route, resolvedPath)}\n`);
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 1;
    }
  }
}

export class LlmRouteDiffCommand extends Command {
  static paths = [["llm", "route", "diff"]];
  llmPathId = Option.String("--path-id", "");
  repoRoot = Option.String("--repo-root", ".");
  inventoryPath = Option.String("--inventory-path", "");
  baselineInventoryPath = Option.String("--baseline-inventory-path", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const {
      buildLlmRouteManifest,
      diffLlmRouteManifests,
      loadLlmRouteInventory,
      renderLlmRouteDiff,
    } = await import("../../commands/llm-route-manifest.ts");

    try {
      const { resolvedPath, inventory } = loadLlmRouteInventory({
        repoRoot: this.repoRoot,
        inventoryPath: this.inventoryPath,
      });
      const { resolvedPath: baselineResolvedPath, inventory: baselineInventory } = loadLlmRouteInventory({
        repoRoot: this.repoRoot,
        inventoryPath: this.baselineInventoryPath,
      });
      const manifest = buildLlmRouteManifest(inventory, resolvedPath);
      const baselineManifest = buildLlmRouteManifest(baselineInventory, baselineResolvedPath);
      const diff = diffLlmRouteManifests(manifest, baselineManifest, { llmPathId: this.llmPathId });
      this.context.stdout.write(this.json ? `${JSON.stringify(diff)}\n` : `${renderLlmRouteDiff(diff)}\n`);
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 1;
    }
  }
}

export const llmCommands = [
  LlmRouteListCommand,
  LlmRouteInspectCommand,
  LlmRouteDiffCommand,
];
