import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "..", "..", "..", "..", "..");

/**
 * Phase 1 removed shell transport for capability skills path resolution.
 * Active DOT graphs should no longer shell into `hatch-ops common
 * resolve-capability-*-skills-path`; they should use typed in-process owners.
 */
function findCapabilitySkillsCommands() {
  const dotDirs = [
    join(REPO_ROOT, "factories"),
    join(REPO_ROOT, "packages"),
  ];
  const pattern = /hatch-ops\s+common\s+(resolve-capability-[a-z-]+-skills-path)/g;
  const found = new Map(); // command -> [file, ...]

  function scanDir(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
        scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".dot")) {
        const content = readFileSync(fullPath, "utf8");
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const cmd = match[1];
          if (!found.has(cmd)) found.set(cmd, []);
          found.get(cmd).push(fullPath.replace(REPO_ROOT + "/", ""));
        }
      }
    }
  }

  for (const dir of dotDirs) {
    scanDir(dir);
  }
  return found;
}

describe("DOT graph capability skills command references", () => {
  const commands = findCapabilitySkillsCommands();

  it("contains no legacy capability-skills shell references in DOT graphs", () => {
    assert.deepEqual(
      [...commands.entries()],
      [],
      `expected zero legacy resolve-capability-*-skills-path shell references, found: ${JSON.stringify([...commands.entries()])}`,
    );
  });
});
