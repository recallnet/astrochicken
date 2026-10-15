const modules = new Map([
  ["/commands/factory-fleet-status.ts", ["fleet", 'export const factoryFleetStatus = (args) => ({ rows: args.collectFactoryRowsFn?.() ?? "raw", outcomes: args.collectFactoryOutcomesFn?.() ?? "raw" });']],
  ["/commands/factory-dashboard.ts", ["dashboard", 'export const buildFactoryDashboard = async (args) => ({ titles: await args.fetchGoalTitlesFn?.() ?? "raw" });']],
  ["/lib/factory-worker-pool.ts", ["pool", 'export const createWorkerPool = () => ({ dispatch: () => "pooled-rows" });']],
  ["/commands/factory-outcomes.ts", ["outcomes", 'export const createCachedCollectFactoryOutcomes = () => () => "cached-outcomes";']],
  ["/lib/fetch-goal-titles-graphql-only.ts", ["titles", 'export const fetchGoalTitlesGraphQLOnly = () => "graphql-titles";']],
]);
const requested = [];

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "publication:import-report") return { url: specifier, shortCircuit: true };
  for (const [suffix, [name]] of modules) {
    if (specifier.endsWith(suffix)) {
      requested.push(name);
      return { url: `publication:${name}`, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === "publication:import-report") {
    return { format: "module", source: `export default ${JSON.stringify(requested)};`, shortCircuit: true };
  }
  for (const [, [name, source]] of modules) {
    if (url === `publication:${name}`) return { format: "module", source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
