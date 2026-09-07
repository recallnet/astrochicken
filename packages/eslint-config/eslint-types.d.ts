// Minimal ESLint type declarations for the custom rule/plugin/config types
// used in this package. ESLint is a devDependency of the workspace root
// and does not ship types resolvable from this package scope.

declare module "eslint" {
  export namespace Rule {
    interface RuleModule {
      meta?: {
        type?: string;
        schema?: unknown[];
        messages?: Record<string, string>;
      };
      create(context: RuleContext): RuleListener;
    }

    interface RuleContext {
      filename: string;
      options: unknown[];
      sourceCode: { getText(): string };
      report(descriptor: ReportDescriptor): void;
    }

    interface ReportDescriptor {
      node: Node;
      messageId?: string;
      message?: string;
      data?: Record<string, string>;
    }

    // eslint AST node — opaque to rule authors
    type Node = Record<string, unknown>;

    type RuleListener = Record<string, ((node: Node) => void) | undefined>;
  }

  export namespace Linter {
    interface Config {
      files?: string[];
      ignores?: string[];
      languageOptions?: Record<string, unknown>;
      plugins?: Record<string, unknown>;
      settings?: Record<string, unknown>;
      rules?: Record<string, unknown>;
    }
  }

  export namespace ESLint {
    interface Plugin {
      meta?: { name?: string };
      rules?: Record<string, Rule.RuleModule>;
    }
  }
}
