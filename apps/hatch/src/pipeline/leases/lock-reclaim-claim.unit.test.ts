import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ afterClaimOpen: undefined as (() => void) | undefined, afterClaimRead: undefined as (() => void) | undefined, afterLeaseUnlink: undefined as (() => void) | undefined }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    unlinkSync: (...args: Parameters<typeof actual.unlinkSync>) => {
      actual.unlinkSync(...args);
      if (String(args[0]).endsWith(".lock") && hooks.afterLeaseUnlink) {
        const callback = hooks.afterLeaseUnlink; hooks.afterLeaseUnlink = undefined; callback();
      }
    },
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      const result = actual.readFileSync(...args);
      if (String(args[0]).endsWith(".reclaim") && hooks.afterClaimRead) {
        const callback = hooks.afterClaimRead; hooks.afterClaimRead = undefined; callback();
      }
      return result;
    },
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      const fd = actual.openSync(...args);
      if (String(args[0]).endsWith(".reclaim") && hooks.afterClaimOpen) {
        const callback = hooks.afterClaimOpen;
        hooks.afterClaimOpen = undefined;
        callback();
      }
      return fd;
    },
  };
});

import { acquireLock, leasePath } from "../lock.js";

const previousRoot = process.env.HATCH_LOCK_DIR;
const roots: string[] = [];
afterEach(() => {
  hooks.afterClaimOpen = undefined;
  hooks.afterClaimRead = undefined;
  hooks.afterLeaseUnlink = undefined;
  if (previousRoot === undefined) delete process.env.HATCH_LOCK_DIR;
  else process.env.HATCH_LOCK_DIR = previousRoot;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function staleFixture() {
  const root = mkdtempSync(join(tmpdir(), "reclaim-claim-"));
  roots.push(root);
  process.env.HATCH_LOCK_DIR = root;
  const release = acquireLock("race", 0, { ownerId: "original", hostId: "old-host" });
  const file = leasePath("race");
  const record = JSON.parse(readFileSync(file, "utf8"));
  release?.();
  writeFileSync(file, JSON.stringify({ ...record, status: "active", heartbeatAt: "2000-01-01T00:00:00.000Z", expiresAt: "2000-01-01T00:00:01.000Z" }));
  return `${file}.original.1.reclaim`;
}

it("denies a contender while an exclusively opened reclaim claim is not yet written", () => {
  staleFixture();
  let nestedRelease: (() => void) | null = null;
  hooks.afterClaimOpen = () => { nestedRelease = acquireLock("race", 0, { ownerId: "nested", hostId: "nested-host" }); };
  const release = acquireLock("race", 0, { ownerId: "winner", hostId: "winner-host" });
  try {
    expect(nestedRelease).toBeNull();
    expect(release).not.toBeNull();
  } finally { release?.(); (nestedRelease as (() => void) | null)?.(); }
});

it("denies fresh invalid claims but recovers abandoned invalid claims after the existing TTL", () => {
  const claim = staleFixture();
  writeFileSync(claim, "");
  expect(acquireLock("race", 0, { ownerId: "blocked" })).toBeNull();
  const previous = new Date(statSync(claim).mtimeMs - 31_000);
  utimesSync(claim, previous, previous);
  const release = acquireLock("race", 0, { ownerId: "recovered" });
  try { expect(release).not.toBeNull(); } finally { release?.(); }
});

 it("does not remove a replacement claim discovered during abandoned-claim inspection", () => {
  const claim = staleFixture();
  writeFileSync(claim, "");
  const old = new Date(Date.now() - 31_000);
  utimesSync(claim, old, old);
  const replacement = JSON.stringify({ pid: process.pid, hostId: "current-host", createdAt: new Date().toISOString() });
  hooks.afterClaimRead = () => {
    writeFileSync(`${claim}.replacement`, replacement);
    renameSync(`${claim}.replacement`, claim);
  };
  const release = acquireLock("race", 0, { ownerId: "blocked", hostId: "current-host" });
  try {
    expect(release).toBeNull();
    expect(readFileSync(claim, "utf8")).toBe(replacement);
  } finally { release?.(); }
});

it("releasing an old reclaim claim preserves a replacement owner's claim", () => {
  const claim = staleFixture();
  const replacement = JSON.stringify({ pid: process.pid, hostId: "replacement", createdAt: new Date().toISOString() });
  hooks.afterLeaseUnlink = () => {
    writeFileSync(`${claim}.replacement`, replacement);
    renameSync(`${claim}.replacement`, claim);
  };
  const release = acquireLock("race", 0, { ownerId: "winner" });
  try {
    expect(release).not.toBeNull();
    expect(readFileSync(claim, "utf8")).toBe(replacement);
  } finally { release?.(); }
});
