#!/usr/bin/env node

import { relinkGlobalCli } from "../packages/factory-ops/src/lib/global-cli-link.ts";

const result = relinkGlobalCli();

if (result.relinked) {
  process.stdout.write(`[post-commit] Linked hatch-ops -> ${result.cli_source}\n`);
} else {
  process.stdout.write(`[post-commit] Skipping hatch-ops relink reason=${result.reason}\n`);
}
