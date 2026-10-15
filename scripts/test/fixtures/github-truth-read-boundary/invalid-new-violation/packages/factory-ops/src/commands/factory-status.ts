export function violating(ghJson) {
  return ghJson(["api", "graphql", "-f", "query=query { viewer { login } }"], null);
}
