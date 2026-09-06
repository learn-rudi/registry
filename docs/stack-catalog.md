# Stack catalog organization

Each stack keeps one stable `stack:<id>` and one folder at
`catalog/stacks/<id>/`, with `manifest.json`, implementation, dependencies and
its verification contract. Categories belong in metadata, never in additional
directory levels. Keep existing IDs stable so installed packages, tool routes
and skill dependencies continue to resolve.

Stacks and their primary operator skills use the same seven categories:
`web`, `code`, `data`, `documents`, `media`, `communication`, and `agents`.
The category describes the primary object of the work; see the definitions in
[Skill catalog organization](skill-catalog.md). Vercel is `web`, Cloudinary is
`media`, and database and finance integrations are `data`.

Every authored stack declares at least one `capability:<slug>` tag. Optional
`domain:<slug>` and `provider:<slug>` tags describe subject area and provider.
Values use lowercase kebab-case. Preserve useful ordinary search tags as well.
For example:

```json
"meta": {
  "category": "web",
  "tags": ["hosting", "capability:deploy", "provider:vercel"]
}
```

The compiler and validator enforce this contract and category agreement with
the primary operator. Legacy package readers remain tolerant of older metadata.
`related.operatorSkill` identifies the primary operator, which must also appear
in `related.skills` and require its stack. Other related skills are optional
companions. A stack has facets but no skill role; requiring a stack alone does
not make a skill its operator.

```bash
rudi search --all --stacks --category=web
rudi search --all --stacks --provider=vercel --capability=deploy
rudi list stacks --domain=real-estate
rudi info stack:vercel --json
rudi which vercel
```

## Verification and release identity

Keep the manifest, Node package and lockfile root versions aligned. A server's
MCP initialization response should report that same release identity. A metadata
category does not establish runtime health, hosted eligibility or maturity:
omitted `surface` remains `local-only`, and omitted lifecycle remains unclassified.

Every stack owns `scripts.verify` in `package.json` or `verify.py`. Run all
contracts with `npm run stacks:verify -- --all --prepare --json` in an isolated
checkout: preparation installs package dependencies and can create build output.
The runner isolates HOME and RUDI_HOME and omits user credentials. Python stacks
need a compatible Python interpreter and package download access. Passing a
contract proves the behavior that contract exercises; record MCP initialization
and tool-list coverage separately from live authenticated provider operations.
Never infer provider availability from an offline or mocked test.

Generate release hashes and inspect the npm payload in a separate clean source
checkout, before preparing individual stacks. Ignored local archives and files
created during verification can affect the hash glob even when npm excludes
them. Preserve local files; a clean source build avoids carrying that state
into portable release evidence.

## Reproducible generated indexes

After editing source, run `npm run indexes:sync`. To check an existing index
using the same timestamp policy as CI, run this from the repository root:

```bash
node --input-type=module <<'JS'
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const { generatedAt } = JSON.parse(fs.readFileSync('index.json', 'utf8'));
const epoch = Date.parse(generatedAt) / 1000;
if (typeof generatedAt !== 'string' || !Number.isInteger(epoch)
    || new Date(epoch * 1000).toISOString() !== generatedAt) {
  throw new Error('index.json generatedAt must be an ISO timestamp with whole-second precision');
}
const result = spawnSync('npm', ['run', 'indexes:check'], {
  stdio: 'inherit', env: { ...process.env, SOURCE_DATE_EPOCH: String(epoch) },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
JS
```

Without `SOURCE_DATE_EPOCH`, compilation uses the current commit timestamp.
A later merge commit can therefore change only `generatedAt`; distinguish that
from package or hash drift. Never hand-edit generated indexes or relax the
source hygiene and module-size gates to make verification pass.
