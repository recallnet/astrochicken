import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function createJsonFixtureRepo(files, { prefix = "json-fixture-repo-" } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [relativePath, value] of Object.entries(files)) {
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  }
  return root;
}
