import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const factoriesRoot = join(repoRoot, "factories");

function collectFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current);
    for (const entry of entries) {
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === ".turbo" || entry === "node_modules" || entry === ".git") continue;
        stack.push(fullPath);
      } else {
        out.push(fullPath);
      }
    }
  }
  return out;
}

test("factory taxonomy regression guard: factories tree contains no legacy renamed-label references (#1338)", () => {
  const files = collectFiles(factoriesRoot);
  const offenders = [];
  const legacyLabel = String.fromCharCode(101, 110, 118, 111, 105);
  // Mirrors release verification command semantics: grep -r "<legacy-label>" factories/

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf8");
    if (content.includes(legacyLabel)) offenders.push(filePath);
  }

  assert.deepEqual(offenders.sort(), []);
});
