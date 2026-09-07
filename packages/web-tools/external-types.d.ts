// Ambient type declarations for dependencies and Node.js builtins that don't
// ship their own types from this package's resolution scope.

declare module "node:assert/strict" {
  import assert from "assert";
  export = assert;
}

declare module "node:test" {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export { test as default };
}

declare var process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  stdout: { write(data: string): boolean };
  stderr: { write(data: string): boolean };
};

declare module "turndown" {
  interface TurndownOptions {
    headingStyle?: string;
    codeBlockStyle?: string;
  }
  interface TurndownRule {
    filter: (node: HTMLElement) => boolean;
    replacement: () => string;
  }
  class TurndownService {
    constructor(options?: TurndownOptions);
    use(plugin: unknown): this;
    addRule(name: string, rule: TurndownRule): this;
    turndown(html: string): string;
  }
  export default TurndownService;
}

declare module "turndown-plugin-gfm" {
  export function gfm(service: unknown): void;
}

declare module "@mozilla/readability" {
  export class Readability {
    constructor(document: Document);
    parse(): { title: string; content: string } | null;
  }
}

declare module "jsdom" {
  export class JSDOM {
    constructor(html: string, options?: { url?: string });
    window: {
      document: Document;
    };
  }
}
