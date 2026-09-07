export function readForObservabilityOnly() {
  return ghJson(["issue", "list", "--label", "reporting"]);
}
