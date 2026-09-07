import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyVisualRefinementEvidence } from "../../src/commands/goal-issue-visual-refinement-evidence.ts";

test("verifyVisualRefinementEvidence skips when review context gate already failed", () => {
  const out = verifyVisualRefinementEvidence({
    reviewContextGatePass: "false",
    reviewContextGateCode: "review_context_missing_required_fields",
  });

  assert.equal(out.visual_refinement_gate_pass, "true");
  assert.equal(out.visual_refinement_gate_code, "skipped_review_context_failed");
  assert.equal(out.visual_refinement_required, "false");
});

test("verifyVisualRefinementEvidence returns not_required when no UI/refinement signal is present", () => {
  const dir = mkdtempSync(join(tmpdir(), "visual-refinement-gate-not-required-"));
  const reviewContextPath = join(dir, "review-context.json");
  const reviewEvidencePath = join(dir, "review-evidence.json");

  writeFileSync(reviewContextPath, JSON.stringify({ issue_excerpt: "Backend parser cleanup only." }, null, 2));
  writeFileSync(reviewEvidencePath, JSON.stringify({ review_evidence_note: "Parser-only maintenance note." }, null, 2));

  const out = verifyVisualRefinementEvidence({
    reviewContextPath,
    reviewEvidencePath,
    reviewContextGatePass: "true",
  });

  assert.equal(out.visual_refinement_gate_pass, "true");
  assert.equal(out.visual_refinement_gate_code, "not_required");
  assert.equal(out.visual_refinement_required, "false");
});

test("verifyVisualRefinementEvidence fails closed when required UI metadata is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "visual-refinement-gate-missing-"));
  const reviewContextPath = join(dir, "review-context.json");
  const reviewEvidencePath = join(dir, "review-evidence.json");
  const factoryRoot = join(dir, "factory");
  mkdirSync(factoryRoot, { recursive: true });

  writeFileSync(join(factoryRoot, "factory.config.json"), JSON.stringify({
    scenarios: { root: "factories/example-web/scenarios/example-web" },
  }, null, 2));

  writeFileSync(reviewContextPath, JSON.stringify({
    issue_excerpt: "UI refinement for pan/zoom interaction smoothness.",
    builder_notes: "Cites AGENTS.md and includes adversarial pass.",
  }, null, 2));

  writeFileSync(reviewEvidencePath, JSON.stringify({
    domain: "ui-refinement",
    visual_risk_class: "high",
    hotspot_files: ["App.tsx"],
    scope_limit_minutes: 45,
    refinement_strategy: "serialize hotspot edits",
    review_evidence_note: "AGENTS.md guidance applied. adversarial review attached.",
  }, null, 2));

  const out = verifyVisualRefinementEvidence({
    reviewContextPath,
    reviewEvidencePath,
    reviewContextGatePass: "true",
    factoryRoot,
  });

  assert.equal(out.visual_refinement_gate_pass, "false");
  assert.equal(out.visual_refinement_gate_code, "visual_refinement_evidence_missing");
  assert.equal(out.visual_refinement_required, "true");
  assert.ok(Array.isArray(out.visual_refinement_missing));
  assert.ok(out.visual_refinement_missing.includes("scenario_sources"));
});

test("verifyVisualRefinementEvidence passes when all visual-refinement evidence is present", () => {
  const dir = mkdtempSync(join(tmpdir(), "visual-refinement-gate-pass-"));
  const reviewContextPath = join(dir, "review-context.json");
  const reviewEvidencePath = join(dir, "review-evidence.json");

  writeFileSync(reviewContextPath, JSON.stringify({
    issue_excerpt: "UI refinement pass for interaction smoothness.",
  }, null, 2));

  writeFileSync(reviewEvidencePath, JSON.stringify({
    domain: "ui-refinement",
    visual_risk_class: "medium",
    hotspot_files: ["ConstellationView.tsx"],
    scope_limit_minutes: 30,
    refinement_strategy: "single-hotspot serialization",
    scenario_sources: ["factories/example-web/scenarios/example-web/interactions/pan-zoom.md"],
    review_evidence_note: "Aligned to AGENT-LEARNINGS.md and AGENTS.md; adversarial counterexample checks recorded.",
  }, null, 2));

  const out = verifyVisualRefinementEvidence({
    reviewContextPath,
    reviewEvidencePath,
    reviewContextGatePass: "true",
    scenarioRoot: "factories/example-web/scenarios/example-web",
  });

  assert.equal(out.visual_refinement_gate_pass, "true");
  assert.equal(out.visual_refinement_gate_code, "ok");
  assert.equal(out.visual_refinement_required, "true");
  assert.deepEqual(out.visual_refinement_missing, []);
});

test("verifyVisualRefinementEvidence does not false-positive on incidental UI/interaction mentions in backend issues", () => {
  const dir = mkdtempSync(join(tmpdir(), "visual-refinement-gate-false-positive-"));
  const reviewContextPath = join(dir, "review-context.json");
  const reviewEvidencePath = join(dir, "review-evidence.json");

  // These issue bodies mention "UI" and "interaction" only in exclusion clauses
  // (e.g. "No UI surface", "No interaction with transport layer").
  // They should NOT trigger the visual refinement gate.
  writeFileSync(reviewContextPath, JSON.stringify({
    issue_excerpt: "Stand up the live-only reward executor. Adding UI/operator dashboard work beyond scope. No interaction with the research transport.",
  }, null, 2));
  writeFileSync(reviewEvidencePath, JSON.stringify({
    review_evidence_note: "Backend executor scaffold. Exposing a UI or API surface for manual repair is out of scope.",
  }, null, 2));

  const out = verifyVisualRefinementEvidence({
    reviewContextPath,
    reviewEvidencePath,
    reviewContextGatePass: "true",
  });

  assert.equal(out.visual_refinement_gate_pass, "true");
  assert.equal(out.visual_refinement_gate_code, "not_required");
  assert.equal(out.visual_refinement_required, "false");
});

test("verifyVisualRefinementEvidence parses required metadata from review evidence text when fields are absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "visual-refinement-gate-parse-text-"));
  const reviewContextPath = join(dir, "review-context.json");
  const reviewEvidencePath = join(dir, "review-evidence.json");

  writeFileSync(reviewContextPath, JSON.stringify({
    issue_excerpt: "UI refinement for pan/zoom smoothness on App.tsx.",
  }, null, 2));

  writeFileSync(reviewEvidencePath, JSON.stringify({
    domain: "ui-refinement",
    review_evidence_note: [
      "visual_risk_class: high",
      "hotspot_files: App.tsx, ConstellationView.tsx",
      "scope_limit_minutes: 45",
      "refinement_strategy: serialize hotspot edits",
      "scenario_sources: factories/example-web/scenarios/example-web/interactions/pan-zoom.md",
      "AGENTS.md and AGENT-LEARNINGS.md guidance applied; adversarial review artifacts captured.",
    ].join("\n"),
  }, null, 2));

  const out = verifyVisualRefinementEvidence({
    reviewContextPath,
    reviewEvidencePath,
    reviewContextGatePass: "true",
    scenarioRoot: "factories/example-web/scenarios/example-web",
  });

  assert.equal(out.visual_refinement_gate_pass, "true");
  assert.equal(out.visual_refinement_gate_code, "ok");
  assert.equal(out.visual_refinement_required, "true");
  assert.deepEqual(out.visual_refinement_missing, []);
});
