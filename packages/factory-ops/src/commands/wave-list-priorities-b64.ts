import { ghJson } from "../lib/cli-helpers.ts";
import { FACTORY_LABEL_KEYS, getFactoryLabelName } from "../lib/factory-label-contract.ts";

const PRIORITIES_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.PRIORITIES);

export function waveListPrioritiesB64({ repo }) {
  if (!repo) return "";

  const output = JSON.stringify(ghJson([
    "issue", "list",
    "--repo", repo,
    "--state", "open",
    "--label", PRIORITIES_LABEL,
    "--limit", "1",
    "--json", "number,title,body",
  ], []));
  return Buffer.from(output).toString("base64");
}
