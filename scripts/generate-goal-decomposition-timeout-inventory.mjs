#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const modulePath = resolve(repoRoot, "apps/hatch/dist/pipeline/goal-decomposition-timeout-inventory.js");
const inventoryDir = resolve(repoRoot, "factories/mothership/inventory");
const inventoryJsonPath = resolve(inventoryDir, "goal-decomposition-timeouts.json");
const inventoryMarkdownPath = resolve(inventoryDir, "goal-decomposition-timeouts.md");

let inventoryModule;
try {
	inventoryModule = await import(modulePath);
} catch (error) {
	console.error("Unable to load inventory generator from apps/hatch/dist.");
	console.error("Run `npm --workspace hatch run build` first.");
	throw error;
}

const inventory = inventoryModule.collectGoalDecompositionTimeoutInventory({ repoRootPath: repoRoot });
const markdown = inventoryModule.renderGoalDecompositionTimeoutInventoryMarkdown(inventory);

mkdirSync(inventoryDir, { recursive: true });
writeFileSync(inventoryJsonPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf-8");
writeFileSync(inventoryMarkdownPath, markdown, "utf-8");
