#!/usr/bin/env node
import { buildCli, normalizeArgv } from "./cli/index.ts";

const cli = buildCli();
await cli.runExit(normalizeArgv(process.argv.slice(2)));
