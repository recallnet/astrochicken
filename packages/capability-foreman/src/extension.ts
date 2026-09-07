import type { ForemanProbeSnapshot } from "./types.js";

export interface ForemanProbeArgs {
  factoryId: string;
}

export interface ForemanExtensionOptions {
  factoryId: string;
  probeHealth: (args: ForemanProbeArgs) => Promise<ForemanProbeSnapshot>;
}

export function createForemanExtension(options: ForemanExtensionOptions) {
  return {
    name: "foreman",
    tools: [
      {
        name: "probe_health",
        description: `Return the current structured health snapshot for factory ${options.factoryId}.`,
        execute: () => options.probeHealth({ factoryId: options.factoryId }),
      },
    ],
  };
}
