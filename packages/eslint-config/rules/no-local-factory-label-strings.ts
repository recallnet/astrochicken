import type { Rule } from "eslint";

const KEY_PROPERTY_NAMES = new Set([
  "keys",
  "addKeys",
  "removeKeys",
  "labelKeys",
  "excludedKeys",
]);

const LABEL_KEY_LITERALS = new Set([
  "goal",
  "feature",
  "bug",
  "ready",
  "wave_in_progress",
  "triaged",
  "duplicate",
  "not_planned",
  "priorities",
  "artifacts",
  "telemetry",
  "quarantined",
  "deferred",
  "factory_tracking",
  "process",
  "blocked_control_plane",
  "merge_followup",
  "managed_factory_bug",
  "human",
  "awaiting_human",
  "blocked",
  "brainstorm",
  "factory_example_trading",
]);

interface ASTNode {
  type: string;
  value?: string | number | boolean | null;
  name?: string;
  key?: ASTNode;
  elements?: Array<ASTNode | null>;
}

function literalValue(node: ASTNode | undefined): string {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  return "";
}

function propertyName(node: ASTNode): string {
  if (node.type === "Identifier") {
    return node.name ?? "";
  }
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  return "";
}

export function createNoLocalFactoryLabelStringsRule(): Rule.RuleModule {
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        noLocalFactoryLabelStrings: "Use FACTORY_LABEL_KEYS constants instead of bare factory label key strings.",
      },
    },
    create(context) {
      function reportIfLabelKey(node: Rule.Node, parentPropertyName: string = ""): void {
        const value = literalValue(node as unknown as ASTNode);
        if (!LABEL_KEY_LITERALS.has(value)) {
          return;
        }
        if (!KEY_PROPERTY_NAMES.has(parentPropertyName)) {
          return;
        }
        context.report({
          node,
          messageId: "noLocalFactoryLabelStrings",
        });
      }

      return {
        Property(node: Rule.Node) {
          const astNode = node as unknown as ASTNode & { value: ASTNode };
          const propName = propertyName(astNode.key!);
          if (!KEY_PROPERTY_NAMES.has(propName)) {
            return;
          }

          if (astNode.value.type === "ArrayExpression") {
            for (const element of astNode.value.elements ?? []) {
              if (element) {
                reportIfLabelKey(element as unknown as Rule.Node, propName);
              }
            }
          } else {
            reportIfLabelKey(astNode.value as unknown as Rule.Node, propName);
          }
        },
      };
    },
  };
}
