import {
  FACTORY_DISTRIBUTED_LEASE_BLOCK_START,
  FACTORY_DISTRIBUTED_LEASE_BLOCK_END,
} from "./lease-holder.ts";
import { parseJson } from "../lib/cli-helpers.ts";

export function parseFactoryDistributedLeaseFromComment(body = "", fallback = null) {
  const text = String(body || "");
  const start = text.indexOf(FACTORY_DISTRIBUTED_LEASE_BLOCK_START);
  const end = text.indexOf(FACTORY_DISTRIBUTED_LEASE_BLOCK_END);
  if (start < 0 || end < 0 || end < start) return fallback;
  const inside = text.slice(start + FACTORY_DISTRIBUTED_LEASE_BLOCK_START.length, end).trim();
  if (!inside) return fallback;
  return parseJson(inside, fallback);
}

export function upsertFactoryDistributedLeaseInComment(body = "", lease = null) {
  const text = String(body || "");
  const json = lease && typeof lease === "object" ? JSON.stringify(lease, null, 2) : "";
  const block = json
    ? `${FACTORY_DISTRIBUTED_LEASE_BLOCK_START}\n${json}\n${FACTORY_DISTRIBUTED_LEASE_BLOCK_END}`
    : "";

  const start = text.indexOf(FACTORY_DISTRIBUTED_LEASE_BLOCK_START);
  const end = text.indexOf(FACTORY_DISTRIBUTED_LEASE_BLOCK_END);

  if (start >= 0 && end >= 0 && end >= start) {
    const before = text.slice(0, start).replace(/\s*$/, "");
    const after = text.slice(end + FACTORY_DISTRIBUTED_LEASE_BLOCK_END.length).replace(/^\s*/, "");
    if (!block) return [before, after].filter(Boolean).join("\n\n").trim();
    return [before, block, after].filter(Boolean).join("\n\n").trim();
  }

  if (!block) return text;
  return text.trim() ? `${text.trim()}\n\n${block}` : block;
}

