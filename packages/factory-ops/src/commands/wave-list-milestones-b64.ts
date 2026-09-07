import { ghJsonPaginated } from "../lib/cli-helpers.ts";

export function waveListMilestonesB64({ repo }) {
  if (!repo) return "";

  const milestones = ghJsonPaginated(`repos/${repo}/milestones?state=open&per_page=100`, [])
    .filter((item) => /^goal-[0-9]+-wave-/.test(String(item?.title || "")))
    .map((item) => ({
      title: String(item?.title || ""),
      number: Number(item?.number || 0),
    }));
  const output = JSON.stringify(milestones);
  return Buffer.from(output).toString("base64");
}
