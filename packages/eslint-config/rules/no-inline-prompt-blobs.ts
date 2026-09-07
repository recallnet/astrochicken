import type { Rule } from "eslint";

interface ASTNode {
  type: string;
  value?: string | number | boolean | null;
  expressions?: ASTNode[];
  quasis?: Array<{ value: { cooked: string | null } }>;
}

function normalizedText(node: ASTNode): string {
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && node.expressions?.length === 0) {
    return (node.quasis ?? []).map((quasi) => quasi.value.cooked || "").join("");
  }
  return "";
}

function looksLikePrompt(text: string, minLength: number): boolean {
  if (text.length < minLength) {
    return false;
  }

  const newlineCount = (text.match(/\n/g) || []).length;
  if (newlineCount < 5) {
    return false;
  }

  const heuristics = [
    "you are ",
    "return json",
    "acceptance criteria",
    "review notes",
    "do not call gh directly",
    "issue body",
  ];

  const lower = text.toLowerCase();
  return heuristics.some((needle) => lower.includes(needle));
}

export function createNoInlinePromptBlobsRule(): Rule.RuleModule {
  return {
    meta: {
      type: "problem",
      schema: [{
        type: "object" as const,
        properties: {
          minLength: { type: "number" as const },
        },
        additionalProperties: false,
      }],
      messages: {
        noInlinePromptBlobs: "Keep large prompts in prompt/skill markdown or a dedicated package instead of inline source strings.",
      },
    },
    create(context) {
      const minLength: number = (context.options[0] as { minLength?: number })?.minLength ?? 600;

      function check(node: Rule.Node): void {
        const text = normalizedText(node as unknown as ASTNode);
        if (!looksLikePrompt(text, minLength)) {
          return;
        }
        context.report({
          node,
          messageId: "noInlinePromptBlobs",
        });
      }

      return {
        Literal: check,
        TemplateLiteral: check,
      };
    },
  };
}
