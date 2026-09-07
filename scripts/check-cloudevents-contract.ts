import { readFileSync } from "node:fs";

import {
  CLOUDEVENTS_REGISTRY_JSON_PATH,
  CLOUDEVENTS_REGISTRY_MARKDOWN_PATH,
  analyzeCloudEventsContract,
  discoverCloudEventSourceModules,
  loadCloudEventSurfaces,
  writeCloudEventArtifacts,
} from "./lib/cloudevents-contract.ts";

const writeMode = process.argv.includes("--write");

const readFile = (filePath) => {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
};

const repoRoot = process.cwd();
const surfaces = await loadCloudEventSurfaces({ repoRoot });
const analysis = analyzeCloudEventsContract({
  surfaces,
  readFile,
  expectedRegistryJson: readFile(CLOUDEVENTS_REGISTRY_JSON_PATH),
  expectedRegistryMarkdown: readFile(CLOUDEVENTS_REGISTRY_MARKDOWN_PATH),
  discoveredSourcePaths: discoverCloudEventSourceModules({ repoRoot }),
});

if (writeMode) {
  writeCloudEventArtifacts(analysis);
}

for (const diagnostic of analysis.diagnostics) {
  process.stdout.write(`[cloudevents_contract] diagnostic ${diagnostic}\n`);
}
process.stdout.write(`[cloudevents_contract] result=${analysis.ok ? "ok" : "fail"} diagnostics=${analysis.diagnostics.length}\n`);
process.stdout.write(`${JSON.stringify(analysis.report.summary)}\n`);
process.exit(analysis.ok ? 0 : 1);
