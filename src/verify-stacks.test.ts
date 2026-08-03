import { describe, expect, it } from "vitest";

import { parseStackVerificationArgs } from "./verify-stacks.js";

describe("parseStackVerificationArgs", () => {
  it("accepts one explicit verification selection mode", () => {
    expect(parseStackVerificationArgs([
      "--stack",
      "stack:zulu",
      "--stack",
      "stack:alpha",
      "--prepare",
      "--json",
    ])).toEqual({
      mode: "selected",
      packageIds: ["stack:alpha", "stack:zulu"],
      prepare: true,
      json: true,
    });

    expect(() => parseStackVerificationArgs([
      "--all",
      "--changed-from",
      "main",
    ])).toThrow("Choose exactly one stack verification selection mode");
  });
});
