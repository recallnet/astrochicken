export function violatingLib(ghJson) {
  return ghJson(["issue", "view", "17", "--repo", "recallnet/astrochicken", "--json", "state"], null);
}
