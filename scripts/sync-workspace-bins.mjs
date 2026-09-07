import { chmodSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptsDir, "..");

export const WORKSPACE_BIN_ENTRIES = [
  { name: "hatch", relativeTarget: ["scripts", "bin", "hatch"] },
  { name: "hatch-ops", relativeTarget: ["scripts", "bin", "hatch-ops"] },
];

export function syncWorkspaceBins(repoRoot = defaultRepoRoot) {
  const binDir = path.resolve(repoRoot, "node_modules", ".bin");
  const entries = WORKSPACE_BIN_ENTRIES.map((entry) => ({
    name: entry.name,
    target: path.resolve(repoRoot, ...entry.relativeTarget),
  }));

  mkdirSync(binDir, { recursive: true });

  for (const entry of entries) {
    chmodSync(entry.target, 0o755);
    const linkPath = path.resolve(binDir, entry.name);
    const relativeTarget = path.relative(path.dirname(linkPath), entry.target);

    try {
      const current = lstatSync(linkPath);
      if (current.isSymbolicLink()) {
        const currentTarget = readlinkSync(linkPath);
        if (currentTarget === relativeTarget) continue;
      }
      unlinkSync(linkPath);
    } catch {}

    try {
      symlinkSync(relativeTarget, linkPath);
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      try {
        const current = lstatSync(linkPath);
        if (current.isSymbolicLink() && readlinkSync(linkPath) === relativeTarget) {
          continue;
        }
        unlinkSync(linkPath);
      } catch {}

      symlinkSync(relativeTarget, linkPath);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncWorkspaceBins();
}
