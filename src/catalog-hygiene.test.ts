import { describe, expect, it } from "vitest";

import { assertCatalogClean, classifyCatalogArtifact } from "./catalog-hygiene.js";

describe("catalog hygiene classification", () => {
  it("allows reproducible untracked artifacts and refuses tracked content", () => {
    expect(classifyCatalogArtifact("node_modules", { trackedFiles: 0, containsFiles: true }))
      .toEqual({ action: "remove", reason: "reproducible artifact" });
    expect(classifyCatalogArtifact("dist", { trackedFiles: 2, containsFiles: true }))
      .toEqual({ action: "refuse", reason: "contains tracked files" });
  });

  it("only removes runtime-state directories when they contain no files", () => {
    expect(classifyCatalogArtifact("runs", { trackedFiles: 0, containsFiles: false }))
      .toEqual({ action: "remove", reason: "empty runtime state" });
    expect(classifyCatalogArtifact("output", { trackedFiles: 0, containsFiles: true }))
      .toEqual({ action: "preserve", reason: "runtime state contains files" });
  });

  it("ignores names outside the cleanup allowlist", () => {
    expect(classifyCatalogArtifact("src", { trackedFiles: 0, containsFiles: true }))
      .toEqual({ action: "ignore", reason: "not a cleanup target" });
  });

  it("fails the check gate when removable targets remain", () => {
    expect(() => assertCatalogClean({
      removed: ["catalog/stacks/demo/node_modules"],
      preserved: [],
      refused: [],
    })).toThrow("Catalog contains 1 removable artifact target(s)");
  });
});
