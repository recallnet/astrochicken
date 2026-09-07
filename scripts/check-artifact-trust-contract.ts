import { readFileSync } from "node:fs";

import {
  analyzeArtifactTrustContract,
  ARTIFACT_TRUST_REGISTRY_JSON_PATH,
  ARTIFACT_TRUST_REGISTRY_MARKDOWN_PATH,
  loadArtifactTrustClasses,
  writeArtifactTrustArtifacts,
} from "./lib/artifact-trust-contract.ts";

function readFileIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const write = process.argv.includes("--write");
const artifactClasses = await loadArtifactTrustClasses({ repoRoot: process.cwd() });
let analysis = analyzeArtifactTrustContract({
  artifactClasses,
  readFile(path) {
    return readFileIfPresent(path);
  },
  expectedRegistryJson: readFileIfPresent(ARTIFACT_TRUST_REGISTRY_JSON_PATH),
  expectedRegistryMarkdown: readFileIfPresent(ARTIFACT_TRUST_REGISTRY_MARKDOWN_PATH),
});

if (write) {
  await writeArtifactTrustArtifacts(analysis);
  analysis = analyzeArtifactTrustContract({
    artifactClasses,
    readFile(path) {
      return readFileIfPresent(path);
    },
    expectedRegistryJson: readFileIfPresent(ARTIFACT_TRUST_REGISTRY_JSON_PATH),
    expectedRegistryMarkdown: readFileIfPresent(ARTIFACT_TRUST_REGISTRY_MARKDOWN_PATH),
  });
}

if (!analysis.ok) {
  for (const diagnostic of analysis.diagnostics) {
    process.stderr.write(`[artifact-trust-contract] fail ${diagnostic}\n`);
  }
  process.stderr.write(`[artifact-trust-contract] result=fail required_classes=${analysis.report.required_classes.length} diagnostics=${analysis.diagnostics.length}\n`);
  process.exit(1);
}

process.stdout.write(`[artifact-trust-contract] result=ok required_classes=${analysis.report.required_classes.length} diagnostics=${analysis.diagnostics.length}${write ? " wrote=true" : ""}\n`);
process.stdout.write(analysis.renderedJson);
