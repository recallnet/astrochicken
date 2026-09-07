import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

import { htmlToMarkdown } from "./html-to-markdown.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_CONTENT_LENGTH = 50;

interface ContentResult {
  url: string;
  markdown: string;
  error: string | null;
}

interface FetchContentOptions {
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export async function fetchContent(url: string | null | undefined, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchFn = globalThis.fetch }: FetchContentOptions = {}): Promise<ContentResult> {
  if (!url || typeof url !== "string" || !url.trim()) {
    return { url: "", markdown: "", error: "url is required" };
  }

  const normalizedUrl = url.trim();

  try {
    const response = await fetchFn(normalizedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HatchBot/1.0)",
        "Accept": "text/html,application/xhtml+xml,text/plain,text/markdown",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return { url: normalizedUrl, markdown: "", error: `HTTP ${response.status} ${response.statusText}` };
    }

    const contentType = response.headers?.get?.("content-type") || "";
    const body = await response.text();

    // If it's already plain text or markdown, return as-is
    if (contentType.includes("text/plain") || contentType.includes("text/markdown") || !contentType.includes("html")) {
      if (body.length >= MIN_CONTENT_LENGTH) {
        return { url: normalizedUrl, markdown: body.trim(), error: null };
      }
    }

    // HTML → Readability → Markdown
    const dom = new JSDOM(body, { url: normalizedUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article?.content) {
      const markdown = htmlToMarkdown(article.content);
      if (markdown.length >= MIN_CONTENT_LENGTH) {
        const title = article.title ? `# ${article.title}\n\n` : "";
        return { url: normalizedUrl, markdown: `${title}${markdown}`, error: null };
      }
    }

    // Fallback: strip non-content elements and convert the whole body
    const fallbackDom = new JSDOM(body, { url: normalizedUrl });
    const doc = fallbackDom.window.document;
    for (const tag of ["script", "style", "nav", "footer", "header", "aside"]) {
      for (const el of doc.querySelectorAll(tag)) el.remove();
    }
    const main = doc.querySelector("main, article, [role=main]") || doc.body;
    if (main) {
      const markdown = htmlToMarkdown(main.innerHTML);
      if (markdown.length >= MIN_CONTENT_LENGTH) {
        return { url: normalizedUrl, markdown, error: null };
      }
    }

    // If we got HTML body but couldn't extract, return raw text as last resort
    if (body.trim().length >= MIN_CONTENT_LENGTH) {
      return { url: normalizedUrl, markdown: body.trim(), error: null };
    }

    return { url: normalizedUrl, markdown: "", error: "could not extract content" };
  } catch (err: unknown) {
    return { url: normalizedUrl, markdown: "", error: String((err as Error)?.message || err) };
  }
}


// --- CLI entry point ---
const isMain = process.argv[1] && (
  process.argv[1].endsWith("/content.ts") ||
  process.argv[1].endsWith("/content.mjs") ||
  process.argv[1].endsWith("/web-fetch.ts") ||
  process.argv[1].endsWith("/web-fetch.mjs")
);

if (isMain) {
  const url = process.argv[2];
  if (!url) {
    process.stderr.write("Usage: web-fetch <url>\n");
    process.exit(1);
  }

  const result = await fetchContent(url);
  if (result.error) {
    process.stderr.write(`Error: ${result.error}\n`);
    process.exit(1);
  }
  process.stdout.write(result.markdown);
}
