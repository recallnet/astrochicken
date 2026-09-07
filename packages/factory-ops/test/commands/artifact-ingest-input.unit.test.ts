import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isGitHubRepoIdentity,
  normalizeRepoList,
  normalizeSourceRepoList,
  normalizeMaxArtifacts,
} from "../../src/commands/artifact-ingest.ts";

describe("isGitHubRepoIdentity", () => {
  it("accepts owner/repo identities", () => {
    assert.equal(isGitHubRepoIdentity("recallnet/astrochicken"), true);
    assert.equal(isGitHubRepoIdentity("example-org/project_1"), true);
  });

  it("rejects non repo identities", () => {
    assert.equal(isGitHubRepoIdentity("mothership"), false);
    assert.equal(isGitHubRepoIdentity(""), false);
    assert.equal(isGitHubRepoIdentity("owner/repo/extra"), false);
  });
});

describe("normalizeRepoList", () => {
  it("accepts an array of repos", () => {
    assert.deepStrictEqual(normalizeRepoList(["a/b", "c/d"]), ["a/b", "c/d"]);
  });

  it("accepts a single string repo", () => {
    assert.deepStrictEqual(normalizeRepoList("a/b"), ["a/b"]);
  });

  it("accepts comma-separated string repos", () => {
    assert.deepStrictEqual(normalizeRepoList("a/b,c/d"), ["a/b", "c/d"]);
  });

  it("trims whitespace from entries", () => {
    assert.deepStrictEqual(normalizeRepoList("  a/b , c/d  "), ["a/b", "c/d"]);
  });

  it("filters empty entries", () => {
    assert.deepStrictEqual(normalizeRepoList(["a/b", "", "  "]), ["a/b"]);
  });

  it("returns empty for undefined", () => {
    assert.deepStrictEqual(normalizeRepoList(undefined), []);
  });

  it("returns empty for empty string", () => {
    assert.deepStrictEqual(normalizeRepoList(""), []);
  });

  it("returns empty for empty array", () => {
    assert.deepStrictEqual(normalizeRepoList([]), []);
  });
});

describe("normalizeSourceRepoList", () => {
  it("keeps valid GitHub repo identities", () => {
    assert.deepStrictEqual(
      normalizeSourceRepoList("recallnet/astrochicken,example/external"),
      ["recallnet/astrochicken", "example/external"],
    );
  });

  it("filters invalid values and keeps valid entries", () => {
    assert.deepStrictEqual(
      normalizeSourceRepoList("mothership,recallnet/astrochicken"),
      ["recallnet/astrochicken"],
    );
  });

  it("falls back to fallbackRepo when input has no valid repo", () => {
    assert.deepStrictEqual(
      normalizeSourceRepoList("mothership", { fallbackRepo: "recallnet/astrochicken" }),
      ["recallnet/astrochicken"],
    );
  });

  it("returns empty when neither input nor fallback is valid", () => {
    assert.deepStrictEqual(
      normalizeSourceRepoList("mothership", { fallbackRepo: "still-not-a-repo" }),
      [],
    );
  });
});

describe("normalizeMaxArtifacts", () => {
  it("accepts positive numeric strings", () => {
    assert.equal(normalizeMaxArtifacts("20"), 20);
  });

  it("accepts positive numbers", () => {
    assert.equal(normalizeMaxArtifacts(15), 15);
  });

  it("falls back for non-numeric input", () => {
    assert.equal(normalizeMaxArtifacts("mothership"), 20);
  });

  it("falls back for zero/negative values", () => {
    assert.equal(normalizeMaxArtifacts("0"), 20);
    assert.equal(normalizeMaxArtifacts("-3"), 20);
  });

  it("supports custom fallback", () => {
    assert.equal(normalizeMaxArtifacts("bad", 7), 7);
  });
});
