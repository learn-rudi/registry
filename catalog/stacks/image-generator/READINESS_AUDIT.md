# Image Generator Stack Readiness Audit

Date: 2026-05-17

Status: working audit and remediation plan

Canonical stack path: `catalog/stacks/image-generator`

## Purpose

The Image Generator stack should be the image-creation layer of the RUDI
content suite. A content workflow should be able to move from an extracted
idea, outline, campaign brief, or social post into generated image assets that
can be handed to downstream social media or publishing stacks.

The stack should be small, agent-safe, and provider-portable. It should not try
to become a full design app. It should expose a dependable MCP tool surface
that agents can use without guessing provider-specific SDK details.

## Target Product Contract

The stack is ready when a RUDI user can:

- Install it from the registry with `rudi install image-generator`.
- Add at least one provider key with `rudi secrets set`.
- Ask an agent to generate a usable social/content image.
- Receive a local output path under `~/.rudi/outputs`.
- Pass that output to other content-suite stacks.
- Inspect which providers/models are available before generation.
- See actionable errors when a key, model, reference, or provider call fails.

## Standards Applied

This audit applies the RUDI engineering standards and SWE operating manual:

- API contract discipline: schemas, stable errors, examples, and versioned behavior.
- Security boundary discipline: agent inputs are untrusted, file paths are untrusted, provider output is untrusted.
- Backend logic discipline: protocol handling, validation, orchestration, and provider side effects should be separated.
- Testing discipline: validate reality, including negative paths and dependency failure.
- Registry discipline: install payload, manifests, dependency install, docs, and catalog hash must be coherent.

## Current Stack Shape

| Area | File | Responsibility |
|---|---|---|
| MCP protocol boundary | `src/server.py` | Declares MCP tools, input schemas, dispatch, final exception redaction |
| Tool orchestration | `src/tools.py` | Public MCP tool handlers, compare loop, result shaping, and compatibility re-exports |
| Shared constants | `src/constants.py` | Limits, default output root, image signatures, secret and model override env names |
| Input validation | `src/validation.py` | Required/optional strings, provider normalization, prompt limits, local reference validation |
| Content formats | `src/formats.py` | Normalized asset formats, aspect ratios, and provider/format compatibility |
| Output policy | `src/outputs.py` | Output-root enforcement, image signature detection, safe generated-image writes |
| Model config | `src/model_config.py` | Provider defaults, known model metadata, aliases, reference config, size maps |
| Model registry | `src/model_registry.py` | Static defaults, env overrides, aliases, reference capability matrix, secret status |
| Provider runtime | `src/provider_runtime.py` | Secret lookup, provider client construction, timeout-bounded provider calls |
| Gallery generation | `src/gallery.py` | Local HTML comparison gallery creation |
| Error envelope | `src/errors.py` | Stable `ok`, `error_kind`, `message` result helpers |
| Provider dispatch | `src/renderer/providers.py` | Provider registry and `provider:model` spec parsing |
| Gemini adapter | `src/renderer/gemini_client.py` | Gemini SDK calls and image-byte extraction |
| OpenAI adapter | `src/renderer/openai_client.py` | OpenAI image generation/edit calls and image-byte extraction |
| Replicate adapter | `src/renderer/replicate_client.py` | Replicate model calls and image-byte extraction |
| Registry manifest | `manifest.json` | Canonical schema-v2 install/runtime metadata |
| User docs | `README.md` | Install, providers, defaults, output handoffs, examples, safety contract |
| Tests | `tests/test_tools.py`, `tests/test_mcp_stdio.py` | Tool behavior, adapter behavior, and MCP stdio smoke tests |

## Current MCP API

### `list_models`

Purpose: return provider presets, aliases, active model IDs, and reference-image
support without making provider API calls.

Current strengths:

- Safe to call without secrets.
- Exposes active model overrides from environment variables.
- Separates provider defaults from provider availability.
- Reports whether each provider secret environment variable is configured
  without making provider API calls.
- Exposes supported content formats and aspect ratios.

Open issues:

- Does not verify that model IDs are available to the account.

### `generate_image`

Purpose: generate one image with one provider and write it under
`~/.rudi/outputs`.

Current strengths:

- Strict provider validation.
- Prompt is literal text only.
- References must be local PNG/JPEG/WebP files under 50 MB.
- Output path is constrained to `~/.rudi/outputs`.
- Existing files are not overwritten.
- Provider calls are timeout-bounded.
- Provider outputs are checked for image signatures before writing.
- Accepts a normalized `format` enum for common content asset shapes.

Open issues:

- Output metadata does not include provider request ID or usage/cost data where available.

### `compare_providers`

Purpose: run the same prompt across multiple provider/model specs and write an
HTML gallery.

Current strengths:

- Per-spec failures are isolated in the result list.
- Reuses provider clients per provider.
- Writes a simple gallery for human review.
- Applies one normalized content format across all compared specs.

Open issues:

- Calls providers serially, which is simpler but slow for comparison sweeps.
- Gallery format is useful but not a stable machine-readable artifact beyond the returned result list.

## Schema Audit

### MCP input schemas

Current status:

- Each tool uses `additionalProperties: false`.
- Required fields are explicit.
- Provider enum is constrained.
- Prompt, reference count, and comparison spec count bounds are declared in the
  MCP input schemas and enforced in runtime validation.
- `API_CONTRACT.md` documents request shapes, response shapes, shared limits,
  and stable error kinds.
- `format` is a constrained enum for normalized content asset shape.

Gaps:

- No central schema objects shared between docs and server declarations.
- No schema snapshots to catch accidental contract changes.
- `model` is intentionally free-form to allow provider model IDs, but the docs need stronger examples and failure behavior.

Decision:

Keep the public API small. Add output schema documentation and tests before
adding new parameters. Avoid a large abstraction layer until the current three
tools are proven through provider smoke tests.

### Registry manifests

Current status:

- `manifest.json` supports current CLI install behavior and validates against the
  registry schema.
- `index.json` includes `stack:image-generator`.
- Registry build includes the package in compiled `dist/index*.json`.

Gaps:

- RUDI manifests cannot express "at least one of these optional secrets is required".
- Secret setup UX may show all provider keys as pending even though one key is enough.
- Version is still `0.1.0`, which is correct for pre-public validation.

Decision:

Keep provider secrets optional in manifests so users can install only the
providers they use. Improve runtime status reporting in `list_models` rather
than marking every provider key required.

## Logic and Separation of Concerns Audit

Current separation is now acceptable for the next release candidate. The public
tool handlers stay in `src/tools.py`, while validation, format rules, output
policy, model metadata, provider runtime setup, and gallery generation live in
focused modules.

Implemented module boundaries:

| Module | Responsibility |
|---|---|
| `validation.py` | Prompt, provider, and reference validation |
| `formats.py` | Content asset format normalization and provider/format compatibility |
| `model_config.py` | Provider defaults, known model metadata, aliases, reference config, size maps |
| `model_registry.py` | Defaults, environment overrides, aliases, reference capability matrix |
| `outputs.py` | Output path policy, image format detection, generated-image writes |
| `provider_runtime.py` | Secret lookup, provider client construction, timeout-bounded calls |
| `gallery.py` | HTML gallery creation |
| `tools.py` | Public MCP tool handlers and result orchestration |

Decision:

Keep this split conservative. Do not add another abstraction layer unless the
next provider or workflow creates real duplication across these modules.

## Technical Debt and Redundancy Audit

Technical debt in this stack is not limited to messy code. The larger risk is
duplicating capability that already exists elsewhere in RUDI, then forcing
agents and users to choose between overlapping tools with different behavior.

### Debt Categories to Track

| Category | What it looks like here | Why it matters |
|---|---|---|
| Capability overlap | `image-generator`, `openai`, and `google-ai` all expose image generation | Agents may pick the wrong tool or learn inconsistent contracts |
| Provider logic duplication | OpenAI/Gemini image SDK calls repeated across stacks | Model updates and API changes must be patched in multiple places |
| Schema duplication | Tool input schemas live in `server.py`, docs, tests, and examples | Contract drift can happen silently |
| Generated index copies | `manifest.json`, root `index.json`, and `dist/index*.json` describe the package at source and release boundaries | Generated indexes can drift if the registry gates are skipped |
| File/path policy drift | Output and reference validation could diverge from other media stacks | Security behavior becomes inconsistent for agents |
| Vendored code drift | Renderer provider modules originated elsewhere | Source ownership can become unclear unless this stack becomes canonical |
| Test duplication without coverage | Tests may repeat happy paths without exercising real boundaries | Gives confidence without protecting the risky behavior |
| Generated artifact churn | `dist/index*.json` and catalog hashes change when registry payload changes | Easy to mix generated updates with unrelated source edits |

### Existing Overlap Inventory

| Existing package | Overlap with image-generator | Intended boundary |
|---|---|---|
| `stack:openai` | OpenAI image generation plus other OpenAI media tools | Provider-suite stack for OpenAI-specific capabilities |
| `stack:google-ai` | Gemini/Imagen image generation plus video generation | Provider-suite stack for Google-specific capabilities |
| `stack:social-media` | Downstream publishing workflow may need image attachments | Publishing and management, not image creation |
| `stack:content-extractor` | Upstream source material can become image prompts | Extraction and summarization, not image generation |
| `stack:video-editor` | Generated images may become thumbnails/title cards | Media assembly/editing, not image generation |

Decision:

`image-generator` should be the normalized agent-facing workflow for content
images. Provider-suite stacks can continue to expose provider-specific tools,
but content agents should prefer this stack when the user intent is "make an
image for this post/campaign/article" rather than "call this provider API".

### Active Debt Register

This register tracks intentional and accidental debt created or discovered
during the image-generator cleanup. Each item should be updated when touched,
not rediscovered later.

| ID | Area | Status | Severity | Debt | Why it exists | Cleanup trigger |
|---|---|---|---|---|---|---|
| DEBT-001 | Model metadata | Open | P2 | Adapter modules still expose `DEFAULT_*` constants and Replicate alias/config names as compatibility aliases over `model_config.py`. | Existing tests and helper imports expected those names; keeping them avoids breaking local callers while centralizing the source of truth. | Remove or deprecate aliases after one release cycle, or once no code imports them directly. |
| DEBT-002 | Model registry | Open | P2 | `module_constants()` retains an AST fallback even though `model_config.py` is now authoritative. | `tools.py` previously exposed AST-backed helpers; fallback keeps compatibility for unusual local callers and tests. | Delete fallback when compatibility re-exports are removed from `tools.py`. |
| DEBT-003 | Tool module API | Open | P2 | `tools.py` re-exports private helper aliases such as `_call_provider`, `_output_path`, and `_renderer_constants`. | Current tests and possible local debugging imports patch those names. | Move tests to module-level helpers directly, then stop exporting private names. |
| DEBT-004 | Schema duplication | Open | P1 | MCP schemas live in `server.py`, contract docs, examples, and response-shape tests. | Fastest path to a stable contract during early stack hardening. | Before adding more public fields, extract shared schema builders or add strict schema snapshots. |
| DEBT-005 | Registry metadata duplication | Resolved | P2 | The parallel version-suffixed manifest was removed; `manifest.json` is the only catalog source. | Generated indexes and the catalog hash remain release artifacts. | Keep `indexes:check` in CI so generated artifacts cannot drift. |
| DEBT-006 | Provider overlap | Open | P1 | `image-generator`, `openai`, and `google-ai` can all generate images. | Provider-suite stacks expose provider-specific breadth; this stack exposes a normalized content workflow. | Document suite routing rules and prefer `image-generator` for content-image intent. |
| DEBT-007 | Replicate model drift | Open | P1 | Replicate support is beta because it depends on model-specific schemas, aliases, aspect-ratio params, and reference params. | Open-source hosted models do not share one stable provider-level schema. | Add verified model metadata and live smoke status per Replicate model before removing the beta label. |
| DEBT-008 | Provider request metadata | Open | P2 | Responses do not include provider request IDs, usage, or cost fields. | The initial contract focused on reliable image bytes and local file paths. | Add after provider SDK response fields are confirmed in live smoke tests. |

### Redundancy Rules for Future Changes

- Before adding a provider, model, or parameter, search existing RUDI stacks for
  the same capability and decide whether to reuse, wrap, or intentionally diverge.
- Do not copy provider code from `openai` or `google-ai` unless this stack is
  explicitly becoming the canonical normalized image workflow.
- If two stacks need identical provider behavior, prefer a shared contract or a
  documented ownership decision over silent copy/paste.
- Keep one public concept per user intent. For example, use `format` for social
  asset shape instead of exposing provider-specific `size`, `aspect_ratio`,
  `dimensions`, and `resolution` knobs at the top level.
- When touching generated registry files, note which source change required the
  regeneration.
- If adding a helper function, first decide whether it belongs in validation,
  output handling, model registry, provider adapter, or gallery generation.
- If a helper is duplicated in two modules, either extract it or document why
  the duplication is intentional and temporary.

### Debt Checklist for Each Work Session

- [ ] Did we search for existing RUDI functionality before adding new code?
- [ ] Did we avoid duplicating provider model lists already maintained elsewhere?
- [ ] Did any manifest, index, docs, or examples drift from each other?
- [ ] Did generated `dist` artifacts change only because source registry payload changed?
- [ ] Did new tests cover behavior, not just mirror implementation?
- [x] Did we keep `tools.py` small enough that no new module extraction is needed?
- [ ] Did we add a provider-specific option to the public API where a normalized content concept would be better?
- [ ] Did we leave any direct local-only path, prototype name, or vendored-source assumption in public docs?
- [ ] Did we add, close, or update Active Debt Register entries for any intentional debt?

## Provider Adapter Audit

### Gemini

Current defaults:

- `sketch`: `gemini-3.1-flash-image-preview`
- `photoreal`: `gemini-3-pro-image-preview`

Strengths:

- Uses Google GenAI SDK.
- Supports prompt plus references for Gemini content-image models.
- Keeps Imagen text-only handling separate.
- Live smoke passed on 2026-05-17 with `gemini-3.1-flash-image-preview`.

Open issues:

- No provider request metadata is returned.

### OpenAI

Current defaults:

- `sketch`: `gpt-image-2`
- `photoreal`: `gpt-image-2`
- `edit`: `gpt-image-2`

Strengths:

- Uses current GPT Image family model ID.
- Supports generation and reference-based edit calls.
- Handles base64 and URL responses.
- Live smoke passed on 2026-05-17 with `gpt-image-1.5`.
- Live smoke passed on 2026-05-17 with `gpt-image-2` using the `story` format.
- Keeps `gpt-image-1.5` and older image models visible in `list_models.known_models`
  for explicit compatibility calls.

Open issues:

- Quality mapping is fixed to low for sketch and high for photoreal.

### Replicate

Current defaults:

- `sketch`: `black-forest-labs/flux-schnell`
- `photoreal`: `black-forest-labs/flux-1.1-pro`
- `edit`: `black-forest-labs/flux-2-max`

Strengths:

- Alias map gives agents usable short names.
- Reference capability matrix is explicit by model.
- `list_models` reports Replicate as beta/model-specific and marks aliases as beta or unverified.

Open issues:

- No live smoke test for Replicate aliases.
- Replicate model set may drift faster than the Gemini/OpenAI defaults that passed live smoke on 2026-05-17.

## Security and Boundary Audit

Current protections:

- Secrets are read from environment only.
- Missing secrets return structured `missing_secret` errors.
- Prompt file reading was removed.
- Reference URLs and data URLs are rejected.
- Reference extensions, content signatures, and file sizes are validated.
- Output writes are constrained to `~/.rudi/outputs`.
- Existing output files and non-empty comparison directories are rejected.
- Unexpected top-level exceptions are redacted for known secret values.

Remaining risks:

- Reference file paths can still point to any local image. That is intentional for agent workflows but should be understood as an upload boundary.
- Provider errors may include provider-side messages. Current top-level exception handling redacts secrets, but provider-specific error messages should still be treated carefully.
- Generated gallery HTML escapes prompt, filenames, and errors, but should remain simple and local-only.
- Live provider calls can cost money. Smoke tests should be explicit and opt-in.

## Testing Audit

Current verification already run:

- Python compile against RUDI Python runtime.
- Unit tests for prompt literal behavior, reference validation, output path policy,
  model defaults, secret status, mocked provider success, missing secrets,
  timeout propagation, invalid provider bytes, comparison bounds, and partial
  comparison failures.
- Response-shape snapshot for `list_models`.
- Provider adapter tests for OpenAI and Replicate PIL reference temp-file cleanup.
- Format validation and aspect-ratio dispatch tests.
- MCP stdio smoke test for `list_tools` and `list_models`.
- Registry v2 validation.
- Registry build and compile.
- Registry Vitest suite.
- Local registry search for `stack:image-generator`.
- Local registry install into a temporary `RUDI_HOME` with existing Python
  runtime linked in.
- Clean-runtime install into a temporary `RUDI_HOME` with Python downloaded from
  the registry release, no runtime symlink.
- MCP stdio call through `rudi mcp image-generator` from the temporary install.
- Live Gemini smoke through an isolated temp install:
  `gemini-3.1-flash-image-preview`, square, JPG, 396,439 bytes, 15,316 ms,
  output `<rudi-home>/outputs/image-20260517-135442-81998756.jpg`.
- Previous live OpenAI smoke through an isolated temp install:
  `gpt-image-1.5`, square, PNG, 197,449 bytes, 10,830 ms,
  output `<rudi-home>/outputs/image-20260517-135541-0cdb8525.png`.
- Live OpenAI latest-model smoke through an isolated temp install:
  `gpt-image-2`, story, PNG, 1,055,146 bytes, 16,430 ms,
  output `<rudi-home>/outputs/image-20260517-142822-ef86b429.png`.
- Catalog hash includes image-generator Python, JSON, Markdown, requirements, and `.env.example` payload files.

Install smoke result:

- `USE_LOCAL_REGISTRY=true RUDI_REGISTRY_ROOT=<registry-root> rudi install image-generator --force`
  now resolves, copies stack source from the local registry, installs Python
  dependencies, and writes the stack under the temporary `RUDI_HOME`.
- A direct MCP client call through `rudi mcp image-generator` can initialize,
  list tools, and call `list_models` from that temporary install.
- The install and MCP smoke were rerun through the built CLI bundle
  (`dist/index.cjs`), not only the source entry point.
- A clean-runtime install was also validated without linking the existing RUDI
  Python runtime; it downloaded Python 3.12.12 and served `list_models` through
  `rudi mcp image-generator`.
- This required CLI support for local stack source copying and `RUDI_HOME`
  override handling. Those fixes live in the RUDI CLI source tree.

Missing tests:

- Live smoke test for Replicate before removing the beta label.

## Documentation Audit

Current docs:

- README explains providers, live smoke baseline, model defaults, output handoffs, safety contract, and examples.
- `.env.example` lists provider keys and documents optional model override names.
- `VENDORED.md` now describes provider modules as canonical stack implementation.
- `API_CONTRACT.md` documents tool requests, success responses, error envelope,
  limits, and examples.

Gaps:

- Live smoke-test results still need to be added after real provider calls are approved.

## Content Suite Fit

The stack should integrate naturally with:

- `content-extractor`: turn extracted articles, transcripts, or briefs into image prompts.
- `social-media`: attach generated image paths to social posts.
- `video-editor`: use generated images as thumbnails, title cards, or b-roll assets.
- `google-ai` and `openai`: coexist as broader provider suites, while this stack provides one normalized image workflow.

Implemented content-format API:

The API now exposes `format` for common content asset shapes:

- `square` (`1:1`) for feed posts
- `portrait` (`2:3`) for vertical feed posts
- `story` (`9:16`) for story and short-form vertical assets
- `landscape` (`3:2`) for link previews and thumbnails

Provider mapping lives in the provider adapters. OpenAI supports `story` with
`gpt-image-2`; older OpenAI image models still reject `story` with
`unsupported_combo`.

## Remediation Plan

### Phase 0: Debt Control During Every Change

- [ ] Search existing RUDI stacks before adding overlapping capability.
- [ ] Record ownership when behavior overlaps `openai`, `google-ai`, or other media stacks.
- [ ] Keep source changes and generated registry artifacts clearly attributable.
- [ ] Update manifests, docs, tests, and examples together when the public contract changes.

Exit gate:

- New work does not introduce untracked duplicate functions, duplicate provider lists, or undocumented stack overlap.

### Phase 1: Contract and Safety Closeout

- [x] Add response schema documentation for all three tools.
- [x] Add `list_models` provider key status without making network calls.
- [x] Add a maximum `specs` count for `compare_providers`.
- [x] Add mocked tests for missing secrets, provider failure, timeout, invalid output bytes, and compare partial failure.
- [x] Add MCP stdio smoke test for `list_tools` and `list_models`.

Exit gate:

- Unit tests cover success and failure behavior without live provider calls.
- MCP tool contract is stable enough for agents to rely on.

### Phase 2: Provider Correctness

- [x] Run live Gemini smoke test with `gemini-3.1-flash-image-preview`.
- [x] Run live OpenAI smoke test with `gpt-image-1.5`.
- [x] Run live OpenAI smoke test with `gpt-image-2`.
- [x] Decide whether Replicate remains first-release or beta-labeled. Decision: beta/model-specific until live-smoked.
- [x] Capture live model IDs in the README provider section.
- [x] Fix OpenAI temporary-file cleanup for PIL reference inputs.

Exit gate:

- At least Gemini and OpenAI generate one image each using real keys.
- Provider defaults are confirmed against docs and real API behavior.

### Phase 3: Content Workflow Fit

- [x] Add optional `format` enum for social/content asset shape.
- [x] Map `format` to provider-specific size/aspect controls.
- [x] Return normalized output metadata including `asset_format`, `aspect_ratio`, `provider`, `model`, `bytes`, and `path`.
- [x] Add examples for social post, story, thumbnail, and blog header use cases.

Exit gate:

- Agents can ask for common content asset shapes without provider-specific prompt hacks.

### Phase 4: Mechanical Refactor

- [x] Split validation/path logic out of `tools.py`.
- [x] Split model matrix and environment override logic out of `tools.py`.
- [x] Split gallery writing out of `tools.py`.
- [x] Keep public MCP behavior unchanged during the split.

Exit gate:

- Same tests pass before and after refactor.
- `tools.py` only orchestrates public tool behavior.

### Phase 5: Registry and Install Readiness

- [x] Test `rudi install image-generator` with `USE_LOCAL_REGISTRY=true`.
- [x] Test fresh install into a temporary `RUDI_HOME`.
- [x] Confirm dependency hydration creates a working Python environment.
- [x] Confirm `rudi mcp image-generator` can answer `list_models`.
- [x] Confirm compiled `dist/index*.json` and catalog hash include all payload files.

Exit gate:

- A new user can install, configure one key, restart the agent, and generate an image.

### Phase 6: Suite Integration

- [ ] Document handoff from content extractor output to image prompt.
- [ ] Document handoff from generated image path to social-media stack.
- [ ] Add a sample workflow prompt for "article to social post image".
- [ ] Decide whether image-generator should be installed by default with social-media/content-extractor bundles.

Exit gate:

- The stack is not just installable. It is usable as part of the RUDI content creation suite.

## Priority Issue List

| Priority | Issue | Why it matters | Proposed fix |
|---|---|---|---|
| P1 | Schema objects are still duplicated | Tool schemas, docs, and tests can drift as the contract evolves | Extract shared schema helpers or add schema snapshots before adding more fields |
| P1 | Active debt register needs ownership discipline | Intentional compatibility debt can become permanent if not reviewed | Update the register whenever helpers, schemas, manifests, or provider catalogs change |
| P1 | Suite handoff docs are still thin | Agents need a clear path from extracted content to generated image to social publishing | Add workflow examples for content-extractor and social-media integration |
| P1 | Capability overlap with `openai` and `google-ai` stacks | Redundant image tools can confuse agents and duplicate provider maintenance | Document ownership and prefer this stack for normalized content images |
| P2 | Replicate beta verification remains pending | Replicate schemas and hosted model defaults may drift faster than Gemini/OpenAI | Live-smoke target aliases before removing the beta label |
| P2 | Provider request metadata is not returned | Agents cannot report request IDs, usage, or cost when providers expose them | Add provider metadata only after live smoke tests confirm available SDK fields |

## Definition of Public Ready

The stack is public-ready when all of the following are true:

- [x] `rudi install image-generator` succeeds from registry metadata.
- [x] A clean RUDI install can run `list_models` through MCP.
- [x] One-key setup works for Gemini.
- [x] One-key setup works for OpenAI.
- [x] Missing keys produce actionable structured errors.
- [x] Invalid references and unsafe output paths are rejected.
- [x] Provider failures do not crash the MCP server.
- [x] Tests cover contract, validation, provider failure, and comparison failure.
- [x] README includes install, provider setup, examples, and troubleshooting.
- [x] Registry build, registry tests, Python tests, and debt scan have no blocking errors.

## Current Baseline

Completed in the current registry copy:

- [x] Added canonical registry payload under `catalog/stacks/image-generator`.
- [x] Added legacy and v2 manifests.
- [x] Added root registry index entry.
- [x] Added README and `.env.example`.
- [x] Removed prompt file reads.
- [x] Restricted output writes to `~/.rudi/outputs`.
- [x] Added image reference extension, signature, and size validation.
- [x] Updated OpenAI defaults to `gpt-image-2` while retaining explicit access to `gpt-image-1.5`.
- [x] Kept Gemini sketch default on `gemini-3.1-flash-image-preview`.
- [x] Marked Replicate beta/model-specific in model metadata, docs, and `list_models`.
- [x] Added focused unit tests.
- [x] Split `tools.py` into validation, format, output, model registry, provider runtime, and gallery modules.
- [x] Validated clean-runtime install with downloaded Python 3.12.12 and MCP `list_models`.
- [x] Validated live Gemini and OpenAI generation through isolated temp installs.
- [x] Updated registry catalog hash to include Python stack payloads and `.env.example`.
- [x] Validated v2 manifest and rebuilt registry dist indexes.

Known caveat:

The live `~/.rudi/stacks/image-generator` copy is no longer the source of truth.
Future work should happen in `catalog/stacks/image-generator`, then reinstall or
sync into `~/.rudi/stacks` only for local runtime testing.
