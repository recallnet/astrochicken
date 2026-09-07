#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { IRREVERSIBLE_NODE_COVERAGE_EXCLUSIONS, IRREVERSIBLE_NODE_COVERAGE_GRAPH_INVENTORY } from "./lib/irreversible-node-coverage-exclusions.ts";
import { IRREVERSIBLE_NODE_COVERAGE_MANIFEST } from "./lib/irreversible-node-coverage-manifest.ts";
import { loadGraphSemanticsText } from "./lib/load-graph-semantics.ts";

const CONTRACT_TEST_PATTERN = /\.contract\.test\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/;
const EXECUTABLE_TEST_PATTERN = /\.test\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/;

function extractNodeBlock(dot, nodeName) {
  const escaped = nodeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\s*\\[[\\s\\S]*?\\]`);
  const match = dot.match(pattern);
  return match ? match[0] : "";
}

const IRREVERSIBLE_NODE_DECL_RE = /([A-Za-z0-9_]+)\s*\[type="tool" governance="irreversible"/gm;

function fileExists(path) {
  return existsSync(path);
}

function testMentionsTarget(testPath, target) {
  if (!fileExists(testPath)) return false;
  const content = readFileSync(testPath, "utf8");
  if (content.includes(target)) return true;
  // Also match when the extension changed (.mjs → .ts) during migration.
  const stem = target.replace(/\.(mjs|js|ts)$/, "");
  return stem && content.includes(stem);
}

function requiresContractGraphReference(graphPath = "") {
  return !String(graphPath || "").endsWith(".workflow-source.mjs");
}

export function extractIrreversibleNodes(dot = "") {
  return [...String(dot).matchAll(IRREVERSIBLE_NODE_DECL_RE)].map((match) => match[1]);
}

export function analyzeIrreversibleNodeCoverage({
  manifest = IRREVERSIBLE_NODE_COVERAGE_MANIFEST,
  exclusions = IRREVERSIBLE_NODE_COVERAGE_EXCLUSIONS,
  graphInventory = IRREVERSIBLE_NODE_COVERAGE_GRAPH_INVENTORY,
} = {}) {
  const violations = [];
  const coveredKeys = new Set();
  const excludedKeys = new Set((exclusions || []).map((entry) => `${entry.graph}::${entry.node}`));

  for (const entry of manifest) {
    coveredKeys.add(`${entry.graph}::${entry.node}`);
    if (!fileExists(entry.graph)) {
      violations.push({ graph: entry.graph, node: entry.node, reason: "graph_missing" });
      continue;
    }
    const dot = loadGraphSemanticsText(entry.graph);
    const nodeBlock = extractNodeBlock(dot, entry.node);
    if (!nodeBlock) {
      violations.push({ graph: entry.graph, node: entry.node, reason: "node_missing" });
      continue;
    }
    if (!/governance="irreversible"/.test(nodeBlock)) {
      violations.push({ graph: entry.graph, node: entry.node, reason: "node_not_irreversible" });
    }
    if (!nodeBlock.includes(entry.prompt_pattern)) {
      violations.push({ graph: entry.graph, node: entry.node, reason: "prompt_pattern_missing" });
    }
    if (!fileExists(entry.command_module)) {
      violations.push({ graph: entry.graph, node: entry.node, reason: "command_module_missing" });
    }

    if (!Array.isArray(entry.contract_tests) || entry.contract_tests.length === 0) {
      violations.push({ graph: entry.graph, node: entry.node, reason: "missing_contract_tests" });
    }
    for (const testPath of entry.contract_tests || []) {
      if (!CONTRACT_TEST_PATTERN.test(testPath)) {
        violations.push({ graph: entry.graph, node: entry.node, reason: "contract_test_not_classified", test: testPath });
        continue;
      }
      if (!fileExists(testPath)) {
        violations.push({ graph: entry.graph, node: entry.node, reason: "contract_test_missing", test: testPath });
        continue;
      }
      if (requiresContractGraphReference(entry.graph) && !testMentionsTarget(testPath, entry.graph)) {
        violations.push({ graph: entry.graph, node: entry.node, reason: "contract_test_missing_graph_reference", test: testPath });
      }
      if (!testMentionsTarget(testPath, entry.prompt_pattern)) {
        violations.push({ graph: entry.graph, node: entry.node, reason: "contract_test_missing_prompt_reference", test: testPath });
      }
    }

    if (!Array.isArray(entry.executable_tests) || entry.executable_tests.length === 0) {
      violations.push({ graph: entry.graph, node: entry.node, reason: "missing_executable_tests" });
    }
    for (const testPath of entry.executable_tests || []) {
      if (!EXECUTABLE_TEST_PATTERN.test(testPath) || CONTRACT_TEST_PATTERN.test(testPath)) {
        violations.push({ graph: entry.graph, node: entry.node, reason: "executable_test_not_behavioral", test: testPath });
        continue;
      }
      if (!fileExists(testPath)) {
        violations.push({ graph: entry.graph, node: entry.node, reason: "executable_test_missing", test: testPath });
        continue;
      }
      if (!testMentionsTarget(testPath, basename(entry.command_module))) {
        violations.push({ graph: entry.graph, node: entry.node, reason: "executable_test_missing_command_reference", test: testPath });
      }
    }
  }

  for (const entry of exclusions || []) {
    if (!fileExists(entry.graph)) {
      violations.push({ graph: entry.graph, node: entry.node, reason: "excluded_graph_missing" });
      continue;
    }
    const dot = loadGraphSemanticsText(entry.graph);
    const nodeBlock = extractNodeBlock(dot, entry.node);
    if (!nodeBlock) {
      violations.push({ graph: entry.graph, node: entry.node, reason: "excluded_node_missing" });
      continue;
    }
    if (!/governance="irreversible"/.test(nodeBlock)) {
      violations.push({ graph: entry.graph, node: entry.node, reason: "excluded_node_not_irreversible" });
    }
    if (!String(entry.reason || "").trim()) {
      violations.push({ graph: entry.graph, node: entry.node, reason: "excluded_reason_missing" });
    }
  }

  for (const graph of graphInventory || []) {
    if (!fileExists(graph)) {
      violations.push({ graph, node: "", reason: "inventory_graph_missing" });
      continue;
    }
    const dot = loadGraphSemanticsText(graph);
    const nodes = extractIrreversibleNodes(dot);
    for (const node of nodes) {
      const key = `${graph}::${node}`;
      if (!coveredKeys.has(key) && !excludedKeys.has(key)) {
        violations.push({ graph, node, reason: "node_unaccounted_for" });
      }
    }
  }

  return {
    checked: manifest.length,
    excluded: (exclusions || []).length,
    violations,
  };
}

async function loadManifestBundleFromPath(manifestPath) {
  const resolvedPath = resolve(manifestPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Manifest file not found: ${resolvedPath}`);
  }
  const module = await import(`file://${resolvedPath}`);
  const manifest = module.IRREVERSIBLE_NODE_COVERAGE_MANIFEST;
  if (!Array.isArray(manifest)) {
    throw new Error(`Manifest file must export IRREVERSIBLE_NODE_COVERAGE_MANIFEST: ${resolvedPath}`);
  }
  return {
    manifest,
    exclusions: Array.isArray(module.IRREVERSIBLE_NODE_COVERAGE_EXCLUSIONS) ? module.IRREVERSIBLE_NODE_COVERAGE_EXCLUSIONS : IRREVERSIBLE_NODE_COVERAGE_EXCLUSIONS,
    graphInventory: Array.isArray(module.IRREVERSIBLE_NODE_COVERAGE_GRAPH_INVENTORY) ? module.IRREVERSIBLE_NODE_COVERAGE_GRAPH_INVENTORY : [...new Set(manifest.map((entry) => entry.graph))],
  };
}

async function resolveManifestBundle(args) {
  const manifestArgIndex = args.indexOf("--manifest");
  if (manifestArgIndex !== -1) {
    const manifestPath = args[manifestArgIndex + 1];
    if (!manifestPath) {
      throw new Error("--manifest requires a path");
    }
    return loadManifestBundleFromPath(manifestPath);
  }
  if (process.env.IRREVERSIBLE_NODE_COVERAGE_MANIFEST) {
    return loadManifestBundleFromPath(process.env.IRREVERSIBLE_NODE_COVERAGE_MANIFEST);
  }
  return {
    manifest: IRREVERSIBLE_NODE_COVERAGE_MANIFEST,
    exclusions: IRREVERSIBLE_NODE_COVERAGE_EXCLUSIONS,
    graphInventory: IRREVERSIBLE_NODE_COVERAGE_GRAPH_INVENTORY,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const { manifest, exclusions, graphInventory } = await resolveManifestBundle(args);
  const result = analyzeIrreversibleNodeCoverage({ manifest, exclusions, graphInventory });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.error(
        `[irreversible-node-coverage] violation graph=${JSON.stringify(violation.graph)} node=${JSON.stringify(violation.node)} reason=${JSON.stringify(violation.reason)}${violation.test ? ` test=${JSON.stringify(violation.test)}` : ""}`,
      );
    }
    console.error(
      `[irreversible-node-coverage] result=fail checked=${result.checked} violations=${result.violations.length}`,
    );
  } else {
    console.log(
      `[irreversible-node-coverage] result=ok checked=${result.checked} violations=0`,
    );
  }

  process.exit(result.violations.length > 0 ? 1 : 0);
}

const isDirectRun = process.argv[1]?.endsWith("check-irreversible-node-coverage.ts") || process.argv[1]?.endsWith("check-irreversible-node-coverage.mjs") === true;
if (isDirectRun) {
  main().catch((error) => {
    console.error(`[irreversible-node-coverage] error=${JSON.stringify(error.message)}`);
    process.exit(1);
  });
}
