#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadAndValidateDocsTemplates, scaffoldDocFromTemplate } from "./lib/docs-template-framework.ts";

function parseArgs(argv) {
  const options = {
    templateId: undefined,
    outputPath: undefined,
    title: undefined,
    owner: undefined,
    status: undefined,
    lastUpdated: undefined,
    reviewPolicy: undefined,
    reviewed: undefined,
    summary: undefined,
    tags: undefined,
    written: undefined,
    manifestPath: undefined,
    list: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--template") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--template requires a value");
      }
      options.templateId = value;
      index += 1;
      continue;
    }

    if (arg === "--output") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--output requires a path");
      }
      options.outputPath = value;
      index += 1;
      continue;
    }

    if (arg === "--title") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--title requires a value");
      }
      options.title = value;
      index += 1;
      continue;
    }

    if (arg === "--owner") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--owner requires a value");
      }
      options.owner = value;
      index += 1;
      continue;
    }

    if (arg === "--status") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--status requires a value");
      }
      options.status = value;
      index += 1;
      continue;
    }

    if (arg === "--last-updated") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--last-updated requires a value");
      }
      options.lastUpdated = value;
      index += 1;
      continue;
    }

    if (arg === "--review-policy") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--review-policy requires a value");
      }
      options.reviewPolicy = value;
      index += 1;
      continue;
    }

    if (arg === "--reviewed") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--reviewed requires a value");
      }
      options.reviewed = value;
      index += 1;
      continue;
    }

    if (arg === "--summary") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--summary requires a value");
      }
      options.summary = value;
      index += 1;
      continue;
    }

    if (arg === "--tags") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--tags requires a value");
      }
      options.tags = value;
      index += 1;
      continue;
    }

    if (arg === "--written") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--written requires a value");
      }
      options.written = value;
      index += 1;
      continue;
    }

    if (arg === "--manifest") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--manifest requires a path");
      }
      options.manifestPath = value;
      index += 1;
      continue;
    }

    if (arg === "--list") {
      options.list = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: node scripts/docs-scaffold-from-template.mjs --template <id> [--output <path>] [--title <value>] [--owner <id>] [--status <value>] [--review-policy <id>] [--reviewed <YYYY-MM-DD>] [--written <YYYY-MM-DD>] [--last-updated <YYYY-MM-DD>] [--summary <text>] [--tags <comma-separated>] [--manifest <path>] [--list]\n");
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));

  if (options.list) {
    const templates = loadAndValidateDocsTemplates({
      cwd: process.cwd(),
      manifestPath: options.manifestPath,
    });

    if (!templates.ok) {
      const first = templates.diagnostics[0];
      throw new Error(`template manifest validation failed (${first.code} at ${first.path}: ${first.message})`);
    }

    const ids = templates.templates.map((entry) => entry.id).sort((left, right) => left.localeCompare(right, "en"));
    process.stdout.write(`${JSON.stringify(ids)}\n`);
    process.exit(0);
  }

  if (!options.templateId) {
    throw new Error("--template is required unless --list is used");
  }

  const output = scaffoldDocFromTemplate({
    cwd: process.cwd(),
    templateId: options.templateId,
    title: options.title,
    owner: options.owner,
    status: options.status,
    lastUpdated: options.lastUpdated,
    reviewPolicy: options.reviewPolicy,
    reviewed: options.reviewed,
    summary: options.summary,
    tags: options.tags,
    written: options.written,
    manifestPath: options.manifestPath,
  });

  if (options.outputPath) {
    const destination = resolve(process.cwd(), options.outputPath);
    writeFileSync(destination, output, "utf8");
    process.stdout.write(`${JSON.stringify({ template_id: options.templateId, output: options.outputPath })}\n`);
    process.exit(0);
  }

  process.stdout.write(output);
} catch (error) {
  process.stderr.write(`[docs-template] fatal=${JSON.stringify({ message: error.message })}\n`);
  process.exit(1);
}
