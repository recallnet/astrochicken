import { readFileSync } from "node:fs";

import type { Rule } from "eslint";

function matchesAny(filePath: string, patterns: string[] = []): boolean {
  return patterns.some((pattern) => {
    if (pattern.startsWith("**/")) {
      return filePath.endsWith(pattern.slice(3));
    }
    if (pattern.includes("*")) {
      const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      return regex.test(filePath);
    }
    return filePath === pattern || filePath.endsWith(pattern);
  });
}

export function createMaxFileLinesRule(): Rule.RuleModule {
  return {
    meta: {
      type: "suggestion",
      schema: [{
        type: "object" as const,
        properties: {
          max: { type: "number" as const },
          include: { type: "array" as const, items: { type: "string" as const } },
          ignore: { type: "array" as const, items: { type: "string" as const } },
        },
        additionalProperties: false,
      }],
      messages: {
        tooManyLines: "File has {{actual}} lines; max allowed is {{max}}.",
      },
    },
    create(context) {
      const filename = context.filename;
      const options = context.options[0] as { max?: number; include?: string[]; ignore?: string[] } | undefined;
      const max: number = options?.max ?? 500;
      const include: string[] = options?.include ?? ["**/*.mjs"];
      const ignore: string[] = options?.ignore ?? [];

      if (!matchesAny(filename, include) || matchesAny(filename, ignore)) {
        return {};
      }

      return {
        "Program:exit"(node: Rule.Node) {
          const lineCount = readFileSync(filename, "utf8").split(/\r?\n/).length;
          if (lineCount <= max) {
            return;
          }
          context.report({
            node,
            messageId: "tooManyLines",
            data: {
              actual: String(lineCount),
              max: String(max),
            },
          });
        },
      };
    },
  };
}
