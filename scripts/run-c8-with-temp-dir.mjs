import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

function run() {
  const forwardedArgs = process.argv.slice(2);
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "astrochicken-c8-"));

  try {
    const result = spawnSync(
      "npx",
      ["c8", "--temp-directory", tempDirectory, ...forwardedArgs],
      {
        cwd: repoRoot,
        stdio: "inherit",
        env: process.env,
      },
    );

    if (result.error) {
      throw result.error;
    }

    process.exit(result.status ?? 1);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

run();
