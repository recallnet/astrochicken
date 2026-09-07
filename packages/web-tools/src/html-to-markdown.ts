import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export function htmlToMarkdown(html: string | null | undefined): string {
  if (!html) return "";

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  turndown.use(gfm);

  // Remove empty links
  turndown.addRule("removeEmptyLinks", {
    filter: (node: HTMLElement) => node.nodeName === "A" && !node.textContent?.trim(),
    replacement: () => "",
  });

  return turndown
    .turndown(String(html))
    .replace(/\[\\?\[\s*\\?\]\]\([^)]*\)/g, "")
    .replace(/ +/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
