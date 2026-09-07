import { ghJson } from "../lib/cli-helpers.ts";
import { FACTORY_LABEL_KEYS, getFactoryLabelName } from "../lib/factory-label-contract.ts";

const READY_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.READY);

export function waveListReadyIssuesB64({ repo }) {
  if (!repo) return "";

  const output = JSON.stringify(ghJson([
    "issue", "list",
    "--repo", repo,
    "--state", "open",
    "--label", READY_LABEL,
    "--limit", "200",
    "--json", "number,title,labels,milestone",
  ], []));
  return Buffer.from(output).toString("base64");
}
