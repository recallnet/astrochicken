import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function ensureFile(repoDir, relativePath, content) {
  const absolutePath = join(repoDir, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

export function simpleStub(envVar, label, extra = "") {
  return `#!/usr/bin/env node\nconst e=Number.parseInt(process.env.${envVar}||'0',10);console.log('${label} result='+(e?'fail':'ok')+'${extra}');process.exit(e);\n`;
}
