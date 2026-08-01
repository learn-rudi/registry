#!/usr/bin/env node
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const PRESENTATIONS_SCOPE = "https://www.googleapis.com/auth/presentations";

function main() {
  const packageRoot = process.cwd();
  const authSource = readFileSync(path.join(packageRoot, "src", "auth.ts"), "utf8");
  const readme = readFileSync(path.join(packageRoot, "README.md"), "utf8");

  assert(
    authSource.includes(`"${PRESENTATIONS_SCOPE}"`),
    "auth must request the Google Slides presentations scope"
  );
  assert(
    readme.includes(PRESENTATIONS_SCOPE),
    "README must document the Google Slides presentations scope"
  );
}

main();
