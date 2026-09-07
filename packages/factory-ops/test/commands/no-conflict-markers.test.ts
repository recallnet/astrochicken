import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(process.cwd(), "packages/factory-ops");
const SKIP_DIRS = new Set(["fixtures", "snapshots"]);

function collectMjsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collectMjsFiles(resolve(dir, entry.name)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".mjs")) {
      out.push(resolve(dir, entry.name));
    }
  }
  return out;
}

const filesToCheck = [
  ...collectMjsFiles(resolve(ROOT, "src")),
  ...collectMjsFiles(resolve(ROOT, "test")),
].sort();

for (const file of filesToCheck) {
  const rel = relative(ROOT, file);
  test(`no unresolved merge markers in ${rel}`, () => {
    const body = readFileSync(file, "utf8");
    assert.equal(/^<<<<<<< /m.test(body), false, `${rel} contains <<<<<<< marker`);
    assert.equal(/^=======$/m.test(body), false, `${rel} contains ======= marker`);
    assert.equal(/^>>>>>>> /m.test(body), false, `${rel} contains >>>>>>> marker`);
  });
}

test("cli executable parses cleanly", () => {
  const cliPath = resolve(ROOT, "src/cli.ts");
  const out = spawnSync(process.execPath, ["--check", cliPath], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr || out.stdout);
});

test("common-resolve-default keeps a single resolveBootstrapAcceptanceCriteria export", () => {
  const body = readFileSync(resolve(ROOT, "src/lib/command-owners/common-resolve-default.ts"), "utf8");
  const exports = body.match(/export function resolveBootstrapAcceptanceCriteria\s*\(/g) ?? [];
  assert.equal(
    exports.length,
    1,
    `expected exactly 1 resolveBootstrapAcceptanceCriteria export, found ${exports.length}`,
  );
});
