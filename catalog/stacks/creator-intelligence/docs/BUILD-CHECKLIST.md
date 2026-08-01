# Creator Intelligence Build Checklist

This checklist tracks the stack build against the SWE Operating Manual:
explicit boundaries, observable behavior, tested changes, and no duplicated
extractor logic.

## Current Contract

- The stack owns creator-audit orchestration and local research artifacts.
- Low-level extraction remains delegated to existing tools such as `yt-dlp`,
  Whisper, browser capture, and future content-extractor APIs.
- Audit output lives under `~/.rudi/research/creator-intelligence` by default,
  with explicit environment-variable overrides for custom research roots.
- Full-audit folders should use copied artifacts, not symlinked legacy folders.

## Completed

- [x] Package scaffold exists in the registry catalog as `stack:creator-intelligence`.
- [x] MCP tools are declared in the canonical `manifest.json`.
- [x] Style-reference intake downloads shortform video, creates source metadata,
  contact sheet, keyframe sheet, and README.
- [x] Style-reference transcription extracts audio and writes Whisper artifacts
  when local Whisper is available.
- [x] TikTok profile video index writes JSON, CSV, latest, popular, oldest, and
  profile overview artifacts.
- [x] Full-audit inventory detects platform folders, required docs, normalized
  counts, unified exports, and symlink debt.
- [x] Legacy TikTok imports copy extract JSON files and analysis docs instead of
  creating symlinks.
- [x] Unified export builder normalizes TikTok, YouTube, Substack, and LinkedIn
  captures into JSON and CSV.
- [x] Audit document generator writes deterministic platform registry,
  cross-platform snapshot, and final synthesis markdown from the unified export.
- [x] Behavior-level tests cover unified export normalization, document
  generation, and unified-export inventory naming.
- [x] Installed local RUDI stack is rebuilt, indexed, and visible to the router.
- [x] Unified export JSON is validated before document generation.
- [x] Generated unified exports are validated before being written.
- [x] Negative tests cover invalid audit roots, missing platform artifacts, and
  malformed unified export JSON.
- [x] Fixture MCP boundary test covers `creator_full_audit_inventory` without
  live social network calls.

## Verification Log

- [x] `npm test` in `catalog/stacks/creator-intelligence`
- [x] `npm run build` in `catalog/stacks/creator-intelligence`
- [x] `npm run validate` in the registry workspace.
- [x] `npm run compile` in the registry workspace.
- [x] `rudi index --json`
- [x] `rudi daemon restart --json`
- [x] MCP smoke:
  `creator-intelligence.creator_full_audit_inventory` against a local
  `{creator_slug}-full` audit fixture.
- [x] Agent debt scan on `src/index.ts`, `src/full-audit.ts`, and
  `test/full-audit.test.ts` returned zero findings.
- [x] Phase 6 test suite covers 8 behavior tests.

## Known Debt And Boundaries

- [ ] Existing legacy audit data may contain TikTok symlinks. The new stack
  reports them and should not create new symlinks.
- [ ] Browser-captured profile state is still manual or external. TikTok bio,
  follower counts, pinned videos, playlists, and visual profile screenshots need
  a browser capture layer before the profile audit is complete.
- [ ] Theme bucketing, hook extraction, era analysis, and cross-platform matching
  are not yet deterministic stack tools.
- [ ] `src/index.ts` is the MCP boundary and remains large. Keep new business
  logic in focused modules like `src/full-audit.ts`; do not add more normalization
  logic directly to the boundary file.
- [ ] Reddit, Instagram, LinkedIn auth/session handling, and customer-facing
  report rendering are out of this stack's current implementation scope.

## Next Build Phases

### Phase 6 - Hardening

- [x] Add schema validation for generated unified export JSON.
- [x] Add negative tests for invalid audit roots, missing platform files, and
  malformed JSON.
- [ ] Add retry/timeout reporting around profile indexing and media download
  subprocesses.
- [x] Add fixture-based smoke tests for the MCP boundary without requiring live
  social network calls.

### Phase 7 - Browser Capture

- [ ] Add a browser/profile snapshot contract for TikTok profile state that
  produces deterministic JSON plus screenshot artifacts.
- [ ] Keep browser capture as an orchestration layer; do not duplicate extractor
  logic inside this stack.
- [ ] Document which profile fields are browser-only versus extractor-provided.

### Phase 8 - Analysis Tools

- [ ] Add deterministic hook-pattern extraction from transcripts and captions.
- [ ] Add theme bucketing with stored evidence and model/provider metadata when
  an LLM is used.
- [ ] Add cross-platform matching across normalized posts.
- [ ] Add report sections that separate observed facts from inferred analysis.

### Phase 9 - Product Surface

- [ ] Decide whether this remains a local RUDI stack only or also backs a remote
  API/MCP service.
- [ ] If remote, define auth, quotas, billing tiers, job storage, and API keys in
  the content-engine product instead of this local stack.
- [ ] Build rendered reports only after the normalized export and analysis schema
  are stable.
