import codecontext from "@recallnet/codecontext-eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import boundaries from "eslint-plugin-boundaries";
import importX from "eslint-plugin-import-x";
import globals from "globals";

import { hatchPlugin } from "./plugin.ts";

import type { Linter } from "eslint";

const JS_GLOBS: string[] = ["**/*.js", "**/*.mjs", "**/*.cjs"];
const TS_GLOBS: string[] = ["**/*.ts", "**/*.mts", "**/*.cts", "**/*.tsx"];
const SOURCE_GLOBS: string[] = [...JS_GLOBS, ...TS_GLOBS];

const IGNORE_GLOBS: string[] = [
  "**/dist/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/.hatch/**",
  "**/node_modules/**",
  "**/*.json",
  "**/*.md",
  "**/*.dot",
  "reports/**",
];

const BOUNDARY_ELEMENTS = [
  {
    type: "app",
    pattern: "apps/*/**/*",
    mode: "folder",
    capture: ["appName"],
  },
  {
    type: "package",
    pattern: "packages/*/**/*",
    mode: "folder",
    capture: ["packageName"],
  },
  {
    type: "factory",
    pattern: "factories/*/**/*",
    mode: "folder",
    capture: ["factoryName"],
  },
  {
    type: "script",
    pattern: "scripts/**/*",
    mode: "folder",
  },
] as const;

function makeBaseConfig(): Linter.Config[] {
  return [
    {
      ignores: IGNORE_GLOBS,
    },
    {
      files: SOURCE_GLOBS,
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        globals: {
          ...globals.node,
        },
      },
      plugins: {
        boundaries,
        codecontext,
        "import-x": importX,
        hatch: hatchPlugin,
      },
      settings: {
        "boundaries/elements": BOUNDARY_ELEMENTS,
      },
      rules: {
        "import-x/no-cycle": "error",
        "import-x/no-internal-modules": ["error", {
          forbid: [
            "@hatch/*/src/**",
            "@example-org/*/src/**",
            "hatch/src/**",
          ],
        }],
        "import-x/order": ["error", {
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
            "object",
            "type",
          ],
        }],
        "boundaries/element-types": ["error", {
          default: "allow",
          rules: [
            {
              from: "package",
              disallow: ["app", "factory"],
              message: "packages must not depend on app or factory-local code",
            },
            {
              from: "factory",
              disallow: ["app", "script"],
              message: "factories must stay isolated from app and script runtime code",
            },
            {
              from: "script",
              disallow: ["app", "factory"],
              message: "scripts may depend on packages only, not app or factory-local code",
            },
          ],
        }],
        "hatch/no-scattered-gh-calls": "error",
        "hatch/no-inline-prompt-blobs": ["error", {
          minLength: 600,
        }],
        "hatch/require-telemetry-line": "off",
        "hatch/no-local-factory-label-strings": "error",
        "codecontext/context-hierarchy": "error",
        "codecontext/valid-context-refs": "error",
        "codecontext/no-stale-context": "warn",
        "hatch/max-file-lines": ["error", {
          max: 500,
          include: ["**/*.mjs"],
          ignore: [
            "packages/factory-ops/src/commands/release-rollout-controller.mjs",
            "packages/factory-ops/src/cli/commands/goal.mjs",
            "packages/factory-ops/src/commands/skill-interface-scaffold.mjs",
          ],
        }],
      },
    },
    {
      files: TS_GLOBS,
      languageOptions: {
        parser: tsParser,
        globals: {
          ...globals.node,
        },
      },
    },
    {
      files: [
        "apps/hatch/**",
        "**/*.test.*",
        "**/*.unit.*",
        "**/*.integration.*",
        "**/*.contract.*",
        "scripts/test/**",
      ],
      rules: {
        "import-x/order": "off",
        "hatch/no-inline-prompt-blobs": "off",
        "hatch/no-local-factory-label-strings": "off",
      },
    },
    {
      files: [
        "packages/factory-prompts/**",
        "packages/factory-skills/**",
        "factories/**/skills/**",
        "factories/**/prompts/**",
        "docs/skills/**",
        "packages/factory-ops/src/commands/skill-interface-scaffold.mjs",
      ],
      rules: {
        "hatch/no-inline-prompt-blobs": "off",
      },
    },
    {
      files: [
        "packages/github-adapter/src/github-adapter.ts",
      ],
      rules: {
        "hatch/no-scattered-gh-calls": "off",
      },
    },
    {
      files: ["scripts/**/*.mjs"],
      rules: {
        "hatch/require-telemetry-line": "error",
      },
    },
    {
      files: [
        "packages/factory-ops/src/commands/factory-resume-gate.mjs",
        "packages/factory-ops/src/commands/release-rollout-controller-state.mjs",
        "packages/factory-ops/src/commands/release-rollout-controller.mjs",
        "packages/factory-ops/src/commands/factory-status.mjs",
        "packages/factory-ops/src/lib/factory-state-fleet-projection.mjs",
        "packages/factory-ops/src/lib/factory-state-reader.mjs",
        "packages/factory-ops/src/lib/factory-status-collector.mjs",
      ],
      rules: {
        "import-x/no-cycle": "off",
      },
    },
  ];
}

export default makeBaseConfig;
