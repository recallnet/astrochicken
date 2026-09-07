import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

test("common inspect-json-pair reads primary JSON from stdin with apostrophes/newlines", () => {
  const primary = JSON.stringify([{ id: "F-1", summary: "Owner's summary\nLine two" }]);
  const secondary = JSON.stringify([{ id: "F-2", summary: "secondary" }]);

  const run = spawnSync("node", [
    opsCliPath,
    "common",
    "inspect-json-pair",
    "--secondary",
    secondary,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    input: primary,
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "{}");
  assert.equal(out.decompose_parse_status, "valid_json");
  assert.equal(out.decompose_parse_source, "primary");
  assert.match(out.decompose_proposed_excerpt, /Owner's summary\\nLine two/);
});

test("common fallback-json-pair reads primary JSON from stdin and preserves payload fields", () => {
  const primary = JSON.stringify([{ id: "F-1", summary: "Owner's summary\nLine two" }]);
  const secondary = JSON.stringify([{ id: "F-2", summary: "secondary" }]);

  const run = spawnSync("node", [
    opsCliPath,
    "common",
    "fallback-json-pair",
    "--secondary",
    secondary,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    input: primary,
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "[]");
  assert.equal(Array.isArray(out), true);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].summary, "Owner's summary\nLine two");
});

test("common inspect-json-pair rejects mixed raw and b64 primary transport", () => {
  const run = spawnSync("node", [
    opsCliPath,
    "common",
    "inspect-json-pair",
    "--primary",
    "[]",
    "--primary-b64",
    Buffer.from("[]", "utf8").toString("base64"),
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /primary accepts one transport: --primary or --primary-b64/);
});

test("common fallback-json-pair empty-stdin fallback is deterministic", () => {
  const run = spawnSync("node", [
    opsCliPath,
    "common",
    "fallback-json-pair",
    "--secondary",
    "[]",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    input: "",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "[]");
});
