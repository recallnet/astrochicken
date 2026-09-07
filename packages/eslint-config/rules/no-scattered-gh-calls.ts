import type { Rule } from "eslint";

const CHILD_PROCESS_METHODS = new Set(["spawn", "spawnSync", "execFileSync", "execSync"]);

interface ASTNode {
  type: string;
  value?: string | number | boolean | null;
  source?: ASTNode;
  specifiers?: Array<{ type: string; local: { name: string } }>;
  callee?: { type: string; name?: string };
  arguments?: ASTNode[];
}

function isNodeChildProcess(node: ASTNode | undefined): boolean {
  return node?.type === "Literal" && node.value === "node:child_process";
}

function getImportedChildProcessBindings(node: ASTNode): Set<string> {
  if (node.type !== "ImportDeclaration" || !isNodeChildProcess(node.source)) {
    return new Set();
  }
  return new Set(
    (node.specifiers ?? [])
      .filter((specifier) => specifier.type === "ImportSpecifier")
      .map((specifier) => specifier.local.name),
  );
}

function isLiteralGh(node: ASTNode | undefined): boolean {
  return node?.type === "Literal" && node.value === "gh";
}

export function createNoScatteredGhCallsRule(): Rule.RuleModule {
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        noScatteredGhCalls: "Route GitHub CLI transport through @hatch/github-adapter instead of spawning `gh` directly.",
      },
    },
    create(context) {
      const childProcessBindings = new Set<string>();

      return {
        ImportDeclaration(node: Rule.Node) {
          for (const binding of getImportedChildProcessBindings(node as unknown as ASTNode)) {
            childProcessBindings.add(binding);
          }
        },
        CallExpression(node: Rule.Node) {
          const astNode = node as unknown as ASTNode;
          if (astNode.callee?.type !== "Identifier") {
            return;
          }
          if (!childProcessBindings.has(astNode.callee.name!)) {
            return;
          }
          if (!CHILD_PROCESS_METHODS.has(astNode.callee.name!)) {
            return;
          }
          if (!isLiteralGh(astNode.arguments?.[0])) {
            return;
          }

          context.report({
            node,
            messageId: "noScatteredGhCalls",
          });
        },
      };
    },
  };
}
