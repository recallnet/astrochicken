import type { Rule } from "eslint";

function looksLikeGateScript(filename: string): boolean {
  if (/\.test\./.test(filename)) {
    return false;
  }
  return /\/scripts\/(?:check-|docs-check-|docs-policy-check|lint-dot|run-gates|run-platform-invariant-gates|whole-repo-quality-proof|factory-health-check|run-factory-health-ci|eslint-gate).+\.mjs$/.test(filename);
}

function hasTelemetrySignal(sourceText: string): boolean {
  return sourceText.includes("result=")
    || sourceText.includes("./lib/check-harness.mjs")
    || sourceText.includes("./lib/check-harness.ts")
    || sourceText.includes("formatDocsGraphSummary(")
    || sourceText.includes("formatDocsFrontmatterSummary(")
    || sourceText.includes("formatDocsPolicySummary(")
    || sourceText.includes("formatLintDotSummary(");
}

export function createRequireTelemetryLineRule(): Rule.RuleModule {
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        missingTelemetry: "Gate scripts must emit `[gate_name] result=ok|fail` telemetry.",
      },
    },
    create(context) {
      const filename = context.filename;
      if (!looksLikeGateScript(filename)) {
        return {};
      }

      return {
        "Program:exit"(node: Rule.Node) {
          const sourceText = context.sourceCode.getText();
          if (hasTelemetrySignal(sourceText)) {
            return;
          }
          context.report({
            node,
            messageId: "missingTelemetry",
          });
        },
      };
    },
  };
}
