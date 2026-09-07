// Type declarations for external ESLint plugins and Node.js modules
// that don't ship their own types from this package scope.

declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
}
declare module "@recallnet/codecontext-eslint-plugin" {
  const plugin: Record<string, unknown>;
  export default plugin;
}

declare module "@typescript-eslint/parser" {
  const parser: Record<string, unknown>;
  export default parser;
}

declare module "eslint-plugin-boundaries" {
  const plugin: Record<string, unknown>;
  export default plugin;
}

declare module "eslint-plugin-import-x" {
  const plugin: Record<string, unknown>;
  export default plugin;
}

declare module "globals" {
  const globals: { node: Record<string, unknown> };
  export default globals;
}
