#!/bin/bash
# Update stack manifests to run TypeScript directly with npx tsx

cd "$(dirname "$0")/.."

for stackdir in catalog/stacks/*/; do
  name=$(basename "$stackdir")
  manifest="${stackdir}manifest.json"

  # Skip archive and non-stack dirs
  if [[ "$name" == "_archive" || "$name" == "README.md" ]]; then
    continue
  fi

  if [[ ! -f "$manifest" ]]; then
    continue
  fi

  # Check if it has TypeScript source
  if [[ -f "${stackdir}src/index.ts" ]]; then
    echo "Updating $name to use npx tsx src/index.ts"
    tmp=$(mktemp)
    jq '. + {runtime: "node", command: ["npx", "tsx", "src/index.ts"]}' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
  elif [[ -f "${stackdir}src/index.js" ]]; then
    echo "Updating $name to use node src/index.js"
    tmp=$(mktemp)
    jq '. + {runtime: "node", command: ["node", "src/index.js"]}' "$manifest" > "$tmp" && mv "$tmp" "$manifest"
  fi
done

echo "Done updating manifests"
