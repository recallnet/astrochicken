export function issueListOwner(ghJson) {
  return ghJson(["issue", "list", "--repo", "recallnet/astrochicken", "--state", "open", "--json", "number"], []);
}
