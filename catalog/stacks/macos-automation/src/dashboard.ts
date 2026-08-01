#!/usr/bin/env node

import { writeAutomationDashboard } from "./core.js";

function parseArgs(argv: string[]): { output_path?: string; open_dashboard: boolean } {
  const input: { output_path?: string; open_dashboard: boolean } = {
    open_dashboard: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--open") {
      input.open_dashboard = true;
      continue;
    }
    if (arg === "--output") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output requires an absolute path");
      input.output_path = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return input;
}

writeAutomationDashboard(parseArgs(process.argv.slice(2)))
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
