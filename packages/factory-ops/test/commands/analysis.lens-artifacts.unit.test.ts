import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeLensArtifacts } from "../../src/lib/analysis/lens-artifacts.ts";

function makeFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "analysis-lens-artifacts-"));
}

test("writeLensArtifacts emits JSON, markdown, and insights artifacts", async () => {
  const root = makeFixtureRoot();
  const outputDir = join(root, "reports", "lens");

  try {
    const result = await writeLensArtifacts({
      outputDir,
      date: "2026-03-14",
      lensJson: { date: "2026-03-14", suggestions: [] },
      markdown: "# Lens\n",
      insightsLatest: [{ id: "one" }],
    });

    assert.equal(result.json_path, join(outputDir, "2026-03-14.json"));
    assert.equal(result.markdown_path, join(outputDir, "2026-03-14.md"));
    assert.equal(result.insights_latest_path, join(outputDir, "insights-latest.json"));

    const json = JSON.parse(readFileSync(result.json_path, "utf8"));
    const markdown = readFileSync(result.markdown_path, "utf8");
    const insights = JSON.parse(readFileSync(result.insights_latest_path, "utf8"));

    assert.equal(json.date, "2026-03-14");
    assert.match(markdown, /^# Lens$/m);
    assert.deepEqual(insights, [{ id: "one" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeLensArtifacts overwrites insights-latest on subsequent runs", async () => {
  const root = makeFixtureRoot();
  const outputDir = join(root, "reports", "lens");

  try {
    await writeLensArtifacts({
      outputDir,
      date: "2026-03-14",
      lensJson: { date: "2026-03-14" },
      markdown: "# run1",
      insightsLatest: [{ id: "old" }],
    });

    await writeLensArtifacts({
      outputDir,
      date: "2026-03-15",
      lensJson: { date: "2026-03-15" },
      markdown: "# run2",
      insightsLatest: [{ id: "new" }],
    });

    const latest = JSON.parse(readFileSync(join(outputDir, "insights-latest.json"), "utf8"));
    assert.deepEqual(latest, [{ id: "new" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeLensArtifacts wraps low-level write failures in lens_write_failed", async () => {
  await assert.rejects(
    () => writeLensArtifacts({
      fs: {
        mkdir: async () => {},
        writeFile: async () => {
          throw new Error("disk-full");
        },
      },
      outputDir: "reports/lens",
      date: "2026-03-14",
      lensJson: {},
      markdown: "",
      insightsLatest: [],
    }),
    /lens_write_failed: output_dir=reports\/lens date=2026-03-14 message=disk-full/,
  );
});
