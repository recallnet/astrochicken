import { readFileSync } from "node:fs";
import path from "node:path";

export const ROADMAP_PATH = "docs/architecture/reactive-factory-dispatch.md";

export function readRoadmap(repoRoot = process.cwd()) {
  return readFileSync(path.join(repoRoot, ROADMAP_PATH), "utf8");
}

export function extractPhaseSection(roadmapText = "", heading = "") {
  const source = String(roadmapText || "");
  const marker = `### ${heading}`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const next = source.indexOf("\n### ", start + marker.length);
  return next < 0 ? source.slice(start) : source.slice(start, next);
}

export function isChecklistLineChecked(sectionText = "", label = "") {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^- \\[x\\] ${escaped}(?:$|\\s+Gates:)`, "m").test(String(sectionText || ""));
}

export function extractChecklistLine(sectionText = "", label = "") {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(sectionText || "").match(new RegExp(`^(- \\[[ x]\\] ${escaped}(?:.*))$`, "m"));
  return match ? match[1] : "";
}

export function extractChecklistLines(sectionText = "", label = "") {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(
    String(sectionText || "").matchAll(new RegExp(`^(- \\[[ x]\\] ${escaped}(?:.*))$`, "gm")),
    (match) => String(match[1] || ""),
  ).filter(Boolean);
}

export function hasConflictingChecklistState(sectionText = "", label = "") {
  const states = new Set(
    extractChecklistLines(sectionText, label)
      .map((line) => line.match(/^- \[([ x])\]/)?.[1] || "")
      .filter(Boolean),
  );
  return states.has("x") && states.has(" ");
}

export function extractChecklistGateIds(sectionText = "", label = "") {
  const line = extractChecklistLine(sectionText, label);
  const gatesSection = line.match(/\bGates:\s*(.+)$/);
  if (!gatesSection) return [];
  return Array.from(gatesSection[1].matchAll(/`([^`]+)`/g), (match) => String(match[1] || "").trim()).filter(Boolean);
}

export function sectionHasDirectGateReference(sectionText = "", gateId = "") {
  return new RegExp(`\\\`${String(gateId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\\``).test(String(sectionText || ""));
}
