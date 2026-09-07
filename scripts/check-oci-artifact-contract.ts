import { readFileSync } from "node:fs";

import {
  analyzeOciArtifactContract,
  discoverOciArtifactPublisherModules,
  discoverOciArtifactSourceModules,
  loadOciArtifactClasses,
  OCI_ARTIFACT_TAXONOMY_JSON_PATH,
  OCI_ARTIFACT_TAXONOMY_MARKDOWN_PATH,
  writeOciArtifactArtifacts,
} from "./lib/oci-artifact-contract.ts";

function readFileIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const write = process.argv.includes("--write");
const repoRoot = process.cwd();
const artifactClasses = await loadOciArtifactClasses({ repoRoot });
const analysis = analyzeOciArtifactContract({
  artifactClasses,
  readFile(path) {
    return readFileIfPresent(path);
  },
  expectedRegistryJson: readFileIfPresent(OCI_ARTIFACT_TAXONOMY_JSON_PATH),
  expectedRegistryMarkdown: readFileIfPresent(OCI_ARTIFACT_TAXONOMY_MARKDOWN_PATH),
  expectedSchemaByPath: Object.fromEntries(
    artifactClasses.map((artifactClass) => [artifactClass.metadataOutputPath, readFileIfPresent(artifactClass.metadataOutputPath)]),
  ),
  discoveredSourcePaths: discoverOciArtifactSourceModules({ repoRoot }),
  discoveredPublisherPaths: discoverOciArtifactPublisherModules({ repoRoot }),
});
const registeredClasses = Array.isArray(analysis.report?.classes) ? analysis.report.classes.length : 0;

if (write) {
  writeOciArtifactArtifacts(analysis);
}

if (!analysis.ok) {
  for (const diagnostic of analysis.diagnostics) {
    process.stderr.write(`[oci-artifact-contract] fail ${diagnostic}\n`);
  }
  process.stderr.write(
    `[oci-artifact-contract] result=fail registered_classes=${registeredClasses} diagnostics=${analysis.diagnostics.length}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `[oci-artifact-contract] result=ok registered_classes=${registeredClasses} diagnostics=${analysis.diagnostics.length}${write ? " wrote=true" : ""}\n`,
);
process.stdout.write(`${analysis.renderedJson}`);
