export function defaultStagedFileContent(stagedPath) {
  if (stagedPath === "apps/hatch/src/cli.ts" || stagedPath === "apps/hatch/src/server/server.ts") {
    return [
      'import { createReactorInstrumentationHelpers } from "./pipeline/reactor-instrumentation.js";',
      "export function bootstrapControlPlane(eventBus) {",
      '  return createReactorInstrumentationHelpers({ eventBus, workflowId: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs" });',
      "}",
      "",
    ].join("\n");
  }
  if (stagedPath.endsWith(".dot")) {
    return "digraph test { a -> b; }\n";
  }
  return `content for ${stagedPath}\n`;
}
