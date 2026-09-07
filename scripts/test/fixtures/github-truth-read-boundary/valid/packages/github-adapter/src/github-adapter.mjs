export function adapterOwner(spawnSync) {
  return spawnSync("gh", ["issue", "view", "1", "--repo", "recallnet/astrochicken", "--json", "state"]);
}
