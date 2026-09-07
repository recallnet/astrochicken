import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseFactoryDistributedLeaseFromComment,
  upsertFactoryDistributedLeaseInComment,
} from "../../src/commands/lease-codec.ts";

import {
  FACTORY_DISTRIBUTED_LEASE_BLOCK_START as START,
  FACTORY_DISTRIBUTED_LEASE_BLOCK_END as END,
} from "../../src/commands/lease-holder.ts";

describe("parseFactoryDistributedLeaseFromComment", () => {
  it("returns null fallback for empty body", () => {
    assert.equal(parseFactoryDistributedLeaseFromComment(""), null);
    assert.equal(parseFactoryDistributedLeaseFromComment(), null);
    assert.equal(parseFactoryDistributedLeaseFromComment(null), null);
    assert.equal(parseFactoryDistributedLeaseFromComment(undefined), null);
  });

  it("returns fallback when no block markers present", () => {
    assert.equal(parseFactoryDistributedLeaseFromComment("just some text"), null);
  });

  it("parses valid JSON from block", () => {
    const lease = { holder: "abc", expires: 123 };
    const body = `${START}\n${JSON.stringify(lease, null, 2)}\n${END}`;
    assert.deepEqual(parseFactoryDistributedLeaseFromComment(body), lease);
  });

  it("returns fallback for invalid JSON inside block", () => {
    const body = `${START}\n{not valid json}\n${END}`;
    assert.equal(parseFactoryDistributedLeaseFromComment(body), null);
  });

  it("returns fallback for empty block", () => {
    const body = `${START}\n\n${END}`;
    assert.equal(parseFactoryDistributedLeaseFromComment(body), null);
  });

  it("returns fallback when end marker appears before start marker", () => {
    const body = `${END}\nsome stuff\n${START}`;
    assert.equal(parseFactoryDistributedLeaseFromComment(body), null);
  });

  it("extracts block embedded in surrounding prose", () => {
    const lease = { id: 42 };
    const body = `Some intro text\n\n${START}\n${JSON.stringify(lease)}\n${END}\n\nTrailing text`;
    assert.deepEqual(parseFactoryDistributedLeaseFromComment(body), lease);
  });

  it("returns custom fallback value when provided", () => {
    const fallback = { default: true };
    assert.deepEqual(
      parseFactoryDistributedLeaseFromComment("no markers", fallback),
      fallback,
    );
    assert.deepEqual(
      parseFactoryDistributedLeaseFromComment("", fallback),
      fallback,
    );
  });
});

describe("upsertFactoryDistributedLeaseInComment", () => {
  it("returns just the block when body is empty and lease is valid", () => {
    const lease = { holder: "x" };
    const result = upsertFactoryDistributedLeaseInComment("", lease);
    assert.ok(result.startsWith(START));
    assert.ok(result.endsWith(END));
    assert.ok(result.includes(JSON.stringify(lease, null, 2)));
  });

  it("appends block after body when no existing block", () => {
    const lease = { holder: "x" };
    const result = upsertFactoryDistributedLeaseInComment("Hello world", lease);
    assert.ok(result.startsWith("Hello world"));
    assert.ok(result.includes(START));
    assert.ok(result.includes(JSON.stringify(lease, null, 2)));
  });

  it("replaces existing block with new lease", () => {
    const old = { holder: "old" };
    const replacement = { holder: "new" };
    const body = `Intro\n\n${START}\n${JSON.stringify(old, null, 2)}\n${END}\n\nOutro`;
    const result = upsertFactoryDistributedLeaseInComment(body, replacement);
    assert.ok(result.includes(JSON.stringify(replacement, null, 2)));
    assert.ok(!result.includes(JSON.stringify(old, null, 2)));
    assert.ok(result.includes("Intro"));
    assert.ok(result.includes("Outro"));
  });

  it("removes block when lease is null, preserving surrounding text", () => {
    const body = `Before\n\n${START}\n{"a":1}\n${END}\n\nAfter`;
    const result = upsertFactoryDistributedLeaseInComment(body, null);
    assert.ok(!result.includes(START));
    assert.ok(!result.includes(END));
    assert.ok(result.includes("Before"));
    assert.ok(result.includes("After"));
  });

  it("returns empty when removing block with no surrounding text", () => {
    const body = `${START}\n{"a":1}\n${END}`;
    const result = upsertFactoryDistributedLeaseInComment(body, null);
    assert.equal(result, "");
  });

  it("roundtrips: parse extracts what upsert wrote", () => {
    const lease = { holder: "factory-1", expires: 999, meta: { nested: true } };
    const body = upsertFactoryDistributedLeaseInComment("Some context", lease);
    const parsed = parseFactoryDistributedLeaseFromComment(body);
    assert.deepEqual(parsed, lease);
  });

  it("treats non-object lease (string) as no block", () => {
    const result = upsertFactoryDistributedLeaseInComment("text", "not-an-object");
    assert.equal(result, "text");
    assert.ok(!result.includes(START));
  });

  it("treats non-object lease (number) as no block", () => {
    const result = upsertFactoryDistributedLeaseInComment("text", 42);
    assert.equal(result, "text");
    assert.ok(!result.includes(START));
  });

  it("preserves text order: header < block < footer", () => {
    const body = `Header line\n\n${START}\n{"old":true}\n${END}\n\nFooter line`;
    const lease = { replaced: true };
    const result = upsertFactoryDistributedLeaseInComment(body, lease);
    assert.ok(result.includes("Header line"));
    assert.ok(result.includes("Footer line"));
    const headerIdx = result.indexOf("Header line");
    const blockIdx = result.indexOf(START);
    const footerIdx = result.indexOf("Footer line");
    assert.ok(headerIdx < blockIdx);
    assert.ok(blockIdx < footerIdx);
  });
});
