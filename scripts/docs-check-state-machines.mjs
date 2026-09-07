#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";

const mdPath = "docs/state-machines.md";
const srcPath = "docs/state-machines.sources.json";

const md = readFileSync(mdPath, "utf8");
const spec = JSON.parse(readFileSync(srcPath, "utf8"));

const errs = [];

if (!md.includes("Status:")) {
  errs.push("state-machines.md must include explicit Status lines.");
}

const mermaidBlocks = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
if (mermaidBlocks.length === 0) {
  errs.push("state-machines.md must contain at least one mermaid block.");
}
for (const [idx, block] of mermaidBlocks.entries()) {
  if (!/\bstateDiagram-v2\b/.test(block)) {
    errs.push(`Mermaid block ${idx + 1} must declare stateDiagram-v2.`);
  }
  const lines = block.split("\n");
  for (const [ln, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;
    // Guard against unquoted second ':' in edge labels (common parser failure in state diagrams)
    // Example bad: A --> B : label: more
    if (/-->.*:\s*[^"']*:[^"']*/.test(trimmed)) {
      errs.push(`Mermaid block ${idx + 1}, line ${ln + 1}: avoid extra ':' in edge labels or quote the label text.`);
    }
  }
}

for (const m of spec.machines || []) {
  const heading = `## ${m.name}`;
  if (!md.includes(heading)) {
    errs.push(`Missing section heading: ${heading}`);
  }
  for (const graph of m.graphs || []) {
    if (!existsSync(graph)) {
      errs.push(`Missing referenced source path: ${graph}`);
    }
  }
}

if (/\blabel:\s*artifact\b/.test(md) || /\b"artifact"\s+label\b/.test(md)) {
  errs.push("Artifact label should be plural: artifacts");
}

if (errs.length > 0) {
  console.error(`[state-machines] result=fail errors=${errs.length}`);
  console.error("state-machines check failed:\n- " + errs.join("\n- "));
  process.exit(1);
}

console.log("[state-machines] result=ok errors=0");
