export function resolveGoalNumberFromMilestoneTitle(title = "") {
  const t = String(title || "").trim();
  const m = t.match(/^goal-(\d+)-wave-\d+$/);
  return m ? m[1] : "";
}
