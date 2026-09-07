export function graphqlOwner(ghJson) {
  return ghJson(["api", "graphql", "-f", "query=query { viewer { login } }"], null);
}
