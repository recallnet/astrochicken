import { createMaxFileLinesRule } from "./rules/max-file-lines.ts";
import { createNoInlinePromptBlobsRule } from "./rules/no-inline-prompt-blobs.ts";
import { createNoLocalFactoryLabelStringsRule } from "./rules/no-local-factory-label-strings.ts";
import { createNoScatteredGhCallsRule } from "./rules/no-scattered-gh-calls.ts";
import { createRequireTelemetryLineRule } from "./rules/require-telemetry-line.ts";

import type { ESLint } from "eslint";

export const hatchPlugin: ESLint.Plugin = {
  meta: {
    name: "@hatch/eslint-plugin",
  },
  rules: {
    "max-file-lines": createMaxFileLinesRule(),
    "no-inline-prompt-blobs": createNoInlinePromptBlobsRule(),
    "no-local-factory-label-strings": createNoLocalFactoryLabelStringsRule(),
    "no-scattered-gh-calls": createNoScatteredGhCallsRule(),
    "require-telemetry-line": createRequireTelemetryLineRule(),
  },
};
