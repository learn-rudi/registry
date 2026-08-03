import fs from "node:fs";
import path from "node:path";

import fg from "fast-glob";
import { describe, expect, it } from "vitest";

const STACK_SOURCE_GLOBS = [
  "catalog/stacks/**/src/**/*.{js,mjs,cjs,ts,tsx,py}",
  "catalog/stacks/**/{test,tests}/**/*.{js,mjs,cjs,ts,tsx,py}",
];

function findLegacyOutputWriters(): string[] {
  const offenders: string[] = [];

  for (const filePath of fg.sync(STACK_SOURCE_GLOBS, { onlyFiles: true })) {
    const source = fs.readFileSync(path.resolve(filePath), "utf8");
    const hardCodedPath = /["']\.rudi["']\s*,\s*["']output["']/;
    const documentedPath = /~\/\.rudi\/output(?:\/|\b)/;
    const absolutePath = /[/\\]\.rudi[/\\]output(?:[/\\]|["'])/;
    if (hardCodedPath.test(source) || documentedPath.test(source) || absolutePath.test(source)) {
      offenders.push(filePath);
    }
  }

  return offenders.sort();
}

describe("generated artifact path contract", () => {
  it("uses ~/.rudi/outputs instead of the legacy singular directory", () => {
    expect(findLegacyOutputWriters()).toEqual([]);
  });
});
