import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyReleaseArtifacts } from "./release-provenance.js";

async function main(): Promise<void> {
  const result = await verifyReleaseArtifacts(process.cwd());
  console.log(`Verified ${result.verified} release artifact SHA-256 hash(es).`);
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
