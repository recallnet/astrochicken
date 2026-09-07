export function templateApiOwner(ghJsonFn, repo = "recallnet/astrochicken") {
  return ghJsonFn(["api", `repos/${repo}/contents/factory.json`], null);
}
