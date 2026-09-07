import { fetchContent } from "./content.ts";

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESULTS = 20;
const DEFAULT_COUNT = 5;
const MAX_CONTENT_LENGTH = 5000;

interface ParsedSearchArgs {
  query: string;
  count: number;
  content: boolean;
  country: string;
  freshness: string | null;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  age: string;
  content?: string;
}

interface BraveSearchOptions {
  apiKey?: string;
  count?: number;
  country?: string;
  freshness?: string | null;
  content?: boolean;
  fetchFn?: typeof fetch;
}

export function parseSearchArgs(argv: string[] = []): ParsedSearchArgs {
  const args = [...argv];
  let count = DEFAULT_COUNT;
  let content = false;
  let country = "US";
  let freshness: string | null = null;

  const extractFlag = (flag: string): boolean | null => {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    args.splice(idx, 1);
    return true;
  };

  const extractFlagValue = (flag: string): string | null => {
    const idx = args.indexOf(flag);
    if (idx === -1 || !args[idx + 1]) return null;
    const value = args[idx + 1];
    args.splice(idx, 2);
    return value;
  };

  if (extractFlag("--content")) content = true;

  const nValue = extractFlagValue("-n");
  if (nValue) count = Math.min(Math.max(parseInt(nValue, 10) || DEFAULT_COUNT, 1), MAX_RESULTS);

  const countryValue = extractFlagValue("--country");
  if (countryValue) country = countryValue.toUpperCase();

  const freshnessValue = extractFlagValue("--freshness");
  if (freshnessValue) freshness = freshnessValue;

  return {
    query: args.join(" ").trim(),
    count,
    content,
    country,
    freshness,
  };
}

export async function braveSearch(query: string, {
  apiKey = "",
  count = DEFAULT_COUNT,
  country = "US",
  freshness = null,
  content = false,
  fetchFn = globalThis.fetch,
}: BraveSearchOptions = {}): Promise<SearchResult[]> {
  const key = apiKey || process.env.BRAVE_API_KEY || "";
  if (!key) {
    throw new Error("BRAVE_API_KEY is required (set via env or apiKey option)");
  }

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(count, MAX_RESULTS)),
    country,
  });
  if (freshness) params.append("freshness", freshness);

  const url = `${BRAVE_API_URL}?${params.toString()}`;
  const response = await fetchFn(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": key,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave API error: HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> } };
  const results: SearchResult[] = [];

  if (data.web?.results) {
    for (const item of data.web.results) {
      if (results.length >= count) break;
      results.push({
        title: item.title || "",
        url: item.url || "",
        snippet: item.description || "",
        age: item.age || "",
      });
    }
  }

  if (content) {
    for (const result of results) {
      const page = await fetchContent(result.url);
      result.content = page.error
        ? `(Error: ${page.error})`
        : page.markdown.substring(0, MAX_CONTENT_LENGTH);
    }
  }

  return results;
}


// --- CLI entry point ---
const isMain = process.argv[1] && (
  process.argv[1].endsWith("/search.ts") ||
  process.argv[1].endsWith("/search.mjs") ||
  process.argv[1].endsWith("/web-search.ts") ||
  process.argv[1].endsWith("/web-search.mjs")
);

if (isMain) {
  const parsed = parseSearchArgs(process.argv.slice(2));
  if (!parsed.query) {
    process.stderr.write("Usage: web-search <query> [-n <count>] [--content] [--country <code>] [--freshness <period>]\n");
    process.exit(1);
  }

  try {
    const results = await braveSearch(parsed.query, {
      count: parsed.count,
      country: parsed.country,
      freshness: parsed.freshness,
      content: parsed.content,
    });
    process.stdout.write(JSON.stringify(results, null, 2));
  } catch (err: unknown) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
