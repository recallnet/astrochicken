import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { GATE_MANIFEST } from "../../lib/gate-manifest.ts";

export function ensureFile(repoDir, relativePath, content) {
  const absolutePath = join(repoDir, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

export function simpleStub(envVar, label, extra = "") {
  return `#!/usr/bin/env node\nconst e=Number.parseInt(process.env.${envVar}||'0',10);console.log('${label} result='+(e?'fail':'ok')+'${extra}');process.exit(e);\n`;
}

// Unrelated manifest gates are mocked only in isolated hook fixtures. Explicit
// gate fixtures remain authoritative for every gate the scenario exercises.
export function seedMissingManifestGateStubs(repoDir) {
  const sourceRoot = resolve(import.meta.dirname, "../../..");
  copyFileSync(join(sourceRoot, "scripts/lib/load-graph-semantics.ts"), join(repoDir, "scripts/lib/load-graph-semantics.ts"));
  for (const relativePath of ["node_modules/acorn", "node_modules/typescript", "packages/factory-core"]) {
    const target = join(repoDir, relativePath);
    if (existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(join(sourceRoot, relativePath), target, "dir");
  }
  for (const gate of GATE_MANIFEST) {
    const script = gate.command === "node" ? gate.args?.[0] : null;
    if (!script?.startsWith("scripts/") || existsSync(join(repoDir, script))) continue;
    ensureFile(repoDir, script, "process.exit(0);\n");
  }
}
