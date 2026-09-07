import { readFileSync } from "node:fs";
import process from "node:process";

const ENFORCED_FILES = [
  "packages/factory-ops/src/cli/commands/release-delivery-cmds.ts",
];

const FORBIDDEN_PATTERNS = [
  { id: "resolve_transport_pair", pattern: /\bresolveTransportPair\s*\(/ },
  { id: "require_transport_payload", pattern: /\brequireTransportPayload\s*\(/ },
  { id: "parse_contract_value", pattern: /\bparseContractValue\s*\(/ },
  { id: "parse_json_flag", pattern: /\bparseJsonFlag\s*\(/ },
  { id: "decode_base64_utf8", pattern: /\bdecodeBase64Utf8\s*\(/ },
  { id: "resolve_b64_or_raw", pattern: /\bresolveB64OrRaw\s*\(/ },
];

function inspectFile(path) {
  const text = readFileSync(path, "utf8");
  const violations = [];
  for (const entry of FORBIDDEN_PATTERNS) {
    if (entry.pattern.test(text)) {
      violations.push({
        path,
        rule: entry.id,
      });
    }
  }
  return violations;
}

export function checkSharedOwnershipEnforcement({
  files = ENFORCED_FILES,
  inspectFileFn = inspectFile,
} = {}) {
  const violations = files.flatMap((path) => inspectFileFn(path));
  return {
    ok: violations.length === 0,
    schema: "shared_ownership_enforcement/v1",
    files,
    violations,
  };
}

function main() {
  const result = checkSharedOwnershipEnforcement();
  if (!result.ok) {
    process.stderr.write(`[shared-ownership] result=fail files=${result.files.length} violations=${result.violations.length}\n`);
    process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`[shared-ownership] result=ok files=${result.files.length} violations=${result.violations.length}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
