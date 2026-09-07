import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { promises as fsPromises } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { emitLensNarrativeDocument } from "../../../src/lib/narrative-document/emit-lens-document.ts";
import { assertNarrativeDocumentContract } from "../../../src/lib/narrative-document/contract.ts";

function makeLensJson() {
  return {
    date: "2026-03-20",
    repo: "recallnet/astrochicken",
    factory_id: "mothership",
    executive_summary: {
      headline: "Daily Lens: contracts stabilized",
      summary: "Daily Lens detected stabilized contract execution after gate tightening.",
    },
    findings: [
      {
        observation: "Gate drift incidents decreased.",
        recommendation: "Keep fail-closed checks in pre-commit.",
      },
    ],
    action_registry: [
      {
        title: "Harden narrative publish check",
        why_now: "Prevents metadata drift from shipping silently.",
      },
    ],
    collector_health: {
      status: "degraded",
      trust_limitations: ["Langfuse lag in latest window."],
    },
    meta_reflection: {
      data_quality_notes: "Collector lag noted but bounded.",
    },
  };
}

test("emitLensNarrativeDocument writes JSON/Markdown and produces contract-valid document", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "lens-narrative-emit-"));
  const result = await emitLensNarrativeDocument({
    reportDate: "2026-03-20",
    issueUrl: "https://github.com/recallnet/astrochicken/issues/2520",
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    lensJson: makeLensJson(),
    outputDir,
  });

  assert.match(result.json_path, /2026-03-20\.narrative\.json$/);
  assert.match(result.markdown_path, /2026-03-20\.narrative\.md$/);

  const parsedJson = JSON.parse(await fsPromises.readFile(result.json_path, "utf8"));
  assert.equal(parsedJson.astrochicken.backlinks.canonical_issue, "https://github.com/recallnet/astrochicken/issues/2520");
  assert.equal(parsedJson.astrochicken.privacy.publishable, false);
  assert.equal(parsedJson.astrochicken.privacy.contains_internal_only, true);
  assert.doesNotThrow(() => assertNarrativeDocumentContract(parsedJson));

  const markdown = await fsPromises.readFile(result.markdown_path, "utf8");
  assert.match(markdown, /^---/);
  assert.match(markdown, /# Daily Lens: contracts stabilized/);
});

test("emitLensNarrativeDocument fails closed without canonical issue URL", async () => {
  await assert.rejects(
    () => emitLensNarrativeDocument({
      reportDate: "2026-03-20",
      issueUrl: "",
      lensJson: makeLensJson(),
      outputDir: mkdtempSync(join(tmpdir(), "lens-narrative-emit-fail-")),
    }),
    /lens_narrative_emit_failed:missing_issue_url/,
  );
});
