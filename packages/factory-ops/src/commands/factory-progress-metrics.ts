import {
  FactoryStateReader,
  formatFactoryProgressMetrics,
} from "../lib/factory-state-reader.ts";

function readerForRunsDir(runsDir = ".hatch/runs") {
  return new FactoryStateReader(runsDir);
}

export { formatFactoryProgressMetrics };

export function collectFactoryProgressMetrics({ repo, ghGraphqlFn, runsDir = ".hatch/runs" } = {}) {
  return readerForRunsDir(runsDir).asMetrics({ repo, ghGraphqlFn, runsDir });
}
