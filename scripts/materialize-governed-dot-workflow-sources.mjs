#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseWithAst } from "./lib/hatch-dot-parser-fallback.ts";

const EXEMPTIONS_PATH = "docs/contracts/governed-execution-dot-exemptions.json";

function trim(value = "") {
  return String(value ?? "").trim();
}

function toFamilyId(packageName = "") {
  return trim(packageName)
    .replace(/^capability-/, "")
    .replace(/^factory-/, "")
    .replace(/-/g, "_");
}

function toTitle(workflowId = "") {
  return trim(workflowId)
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function classifyNodeKind(attrs = {}) {
  const shape = trim(attrs.shape);
  const type = trim(attrs.type);
  if (shape === "Mdiamond") return "start";
  if (shape === "Msquare") return "terminal";
  if (shape === "diamond") return "decision";
  if (type === "pipeline") return "pipeline";
  if (type === "fan_out.dynamic") return "dynamic_fan_out";
  if (type === "fan_out.detached") return "detached_fan_out";
  if (type === "fan_in.dynamic") return "dynamic_fan_in";
  if (trim(attrs.class) || trim(attrs.prompt)) return "llm_prompt";
  return "tool_action";
}

function buildNode(node = {}) {
  const attrs = { ...(node.attrs || {}) };
  const kind = classifyNodeKind(attrs);
  if (kind === "start" || kind === "terminal") {
    delete attrs.type;
    delete attrs.governance;
    delete attrs.prompt;
    delete attrs.prompt_source;
    delete attrs.class;
    delete attrs.output_key;
    delete attrs.output_format;
    delete attrs.outputs;
    delete attrs.action_runtime;
    delete attrs.action_id;
    delete attrs.action_payload;
    delete attrs.action_raw;
    delete attrs.recovery_sink_type;
    for (const key of Object.keys(attrs)) {
      if (key.startsWith("action_")) {
        delete attrs[key];
      }
    }
  }
  return {
    id: trim(node.id),
    kind,
    ...(trim(attrs.label) ? { title: trim(attrs.label) } : {}),
    dotAttributes: attrs,
  };
}

function buildEdge(edge = {}) {
  const attrs = { ...(edge.attrs || {}) };
  const condition = trim(attrs.condition);
  const label = trim(attrs.label);
  return {
    from: trim(edge.from),
    to: trim(edge.to),
    ...(condition ? { condition } : {}),
    ...(label ? { label } : {}),
    ...(Object.keys(attrs).length > 0 ? { dotAttributes: attrs } : {}),
  };
}

function buildWorkflowSourceDocument({ graphPath, graphText, packageName }) {
  const parsed = parseWithAst(graphText);
  const workflowId = path.posix.basename(graphPath, ".dot");
  const familyId = toFamilyId(packageName);
  const workflowDir = path.posix.join("packages", packageName, "workflows", workflowId);
  const sourcePath = path.posix.join(workflowDir, `${workflowId}.workflow-source.mjs`);
  return {
    sourcePath,
    dataPath: path.posix.join(workflowDir, `${workflowId}.workflow-source.data.json`),
    document: {
      schemaVersion: "workflow_source_module/v1",
      workflowId,
      familyId,
      title: toTitle(workflowId),
      description: `Typed workflow source owner for ${graphPath}.`,
      sourcePath,
      runtimeGraphPath: graphPath,
      jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
      ...(parsed.stylesheetImports.length > 0 ? { imports: parsed.stylesheetImports } : {}),
      graphAttributes: Object.fromEntries(
        Object.entries(parsed.graph.attrs || {}).filter(([key]) => key !== "workflow_source"),
      ),
      sourceMap: {
        graphName: workflowId,
        nodeMappings: Object.keys(parsed.graph.nodes || {})
          .sort((left, right) => left.localeCompare(right))
          .map((nodeId) => ({ sourceNodeId: nodeId, runtimeNodeId: nodeId })),
        debugRules: [
          "Generated runtime DOT remains the execution IR for this migrated workflow family.",
          "Operators trace runtime node ids directly through sourceMap.nodeMappings.",
          "workflow_source graph attr points back to this module for source-of-truth lookup.",
        ],
      },
      invariants: {
        mustPreserve: ["edge.condition", "edge.from", "edge.label", "edge.to", "graph.label", "graph.workflow_source", "node.id"],
        mayNormalize: ["attribute_order", "comment_blocks", "whitespace"],
      },
      sourceOwnership: {
        canonicalAuthoringSurface: "typed_workflow_source",
        runtimeIr: "generated_dot_runtime_ir",
      },
      artifacts: [],
      events: [],
      nodes: Object.values(parsed.graph.nodes || {})
        .sort((left, right) => trim(left.id).localeCompare(trim(right.id)))
        .map(buildNode),
      edges: (parsed.graph.edges || []).map(buildEdge),
    },
  };
}

function ensureDirectoryFor(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeModuleWrapper(modulePath, dataPath) {
  const relativeDataPath = `./${path.basename(dataPath)}`;
  const content = [
    `import workflowSourceData from ${JSON.stringify(relativeDataPath)} with { type: "json" };`,
    'import { defineWorkflowSourceModule } from "../../../factory-core/src/workflow-source-registry.ts";',
    "",
    "export const WORKFLOW_SOURCE_MODULE = defineWorkflowSourceModule(workflowSourceData);",
    "export default WORKFLOW_SOURCE_MODULE;",
    "",
  ].join("\n");
  writeFileSync(modulePath, content, "utf8");
}

function listTrackedPackageGraphs() {
  const run = spawnSync("git", ["ls-files", "-z", "packages/*/graphs/*.dot"], {
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`materialize_governed_dot_git_ls_files_failed:${trim(run.stderr || run.stdout)}`);
  }
  return String(run.stdout || "")
    .split("\0")
    .map((entry) => trim(entry))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function main() {
  const report = JSON.parse(readFileSync(EXEMPTIONS_PATH, "utf8"));
  const exemptions = Array.isArray(report.exemptions) ? report.exemptions : [];
  const explicitPackageGraphs = exemptions
    .map((entry) => trim(entry.graph_path))
    .filter((graphPath) => graphPath.startsWith("packages/") && graphPath.endsWith(".dot"));
  const packageGraphs = explicitPackageGraphs.length > 0 ? explicitPackageGraphs : listTrackedPackageGraphs();

  for (const graphPath of packageGraphs) {
    const [, packageName] = graphPath.split("/");
    const graphText = readFileSync(graphPath, "utf8");
    const { sourcePath, dataPath, document } = buildWorkflowSourceDocument({
      graphPath,
      graphText,
      packageName,
    });

    ensureDirectoryFor(sourcePath);
    writeFileSync(dataPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    writeModuleWrapper(sourcePath, dataPath);
    process.stderr.write(`[materialize-governed-dot-workflow-sources] wrote ${sourcePath}\n`);
  }
}

main();
