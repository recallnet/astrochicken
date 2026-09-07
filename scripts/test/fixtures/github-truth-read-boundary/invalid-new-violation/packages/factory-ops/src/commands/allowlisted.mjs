export function allowlisted(ghJson) {
  return ghJson(["issue", "view", "12", "--repo", "recallnet/astrochicken", "--json", "state"], null);
}
