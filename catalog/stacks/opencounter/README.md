# OpenCounter Cincinnati Guidance

Guarded headless-browser MCP boundary for the four public Cincinnati portal
families: zoning, business permits and fee estimates, special events, and
residential guidance.

The four workflow identifiers are exact registered entry profiles. Current
automated page-contract and live proof coverage is zoning; enable the other
three for production only after adding their versioned fixtures and supervised
provider smoke evidence.

The stack uses a fresh isolated browser context for every call. Because the
provider binds anonymous projects to a session, the adapter stores an
AES-256-GCM encrypted, 24-hour envelope containing bounded browser state, the
normalized requested address, and the immutable active checkpoint outside
Service Desk, and resumes it by an opaque project reference. It does not expose arbitrary
navigation or selectors and has no tools for sign-in, account creation, terms
acceptance, uploads, staff messages, application submission, or payment. The
one download capability runs after requester-triggered successful completion or
through the explicit recovery export tool. It dismisses only the provider's
exact optional `Skip for now` save modal and writes the provider PDF to a
bounded, content-addressed local RUDI artifact.
The same exact, single-control modal guard runs before summary interpretation,
so a completed continuation can be read back and reconciled without replaying
its provider mutation. Summary readiness accepts the provider's observed
`H1`-through-`H4` hierarchy instead of assuming every summary has an `H1`.
When the provider omits a classification heading, the bounded result preserves
`classification: null`; it does not infer a zoning outcome. Missing summary
headings or ambiguous save controls still fail closed. A summary is complete
only when its bounded hierarchy includes Location, Zoning District, and Land
Use Code; an incomplete summary containing only Project Details falls back to
the active questionnaire instead of becoming a terminal result.

Install dependencies and the pinned Chromium runtime with:

```bash
npm ci
npm run install-browser
```

`OPENCOUNTER_SESSION_ENCRYPTION_KEY` is required and must be canonical base64
for exactly 32 random bytes. `OPENCOUNTER_STATE_DIRECTORY` may specify an
absolute local state directory; otherwise the stack uses
`~/.rudi/state/opencounter`. Do not print or commit the key. Service Desk never
receives the key or decrypted browser state.

Exported PDFs are written beneath `$RUDI_HOME/artifacts/opencounter` when
`RUDI_HOME` is configured, otherwise beneath
`~/.rudi/artifacts/opencounter`. The stack verifies the `%PDF-` signature,
enforces a 25 MiB maximum, computes SHA-256, uses restrictive file permissions,
rejects non-regular downloads and symbolic-link destinations, and returns
metadata rather than PDF bytes over MCP.

The exact MCP surface is:

```text
opencounter_get_zoning_use_catalog
opencounter_start_zoning_guidance
opencounter_reconcile_zoning_start
opencounter_start_guidance
opencounter_continue_guidance
opencounter_export_guidance
opencounter_get_guidance_result
opencounter_reconcile_guidance
```

`opencounter_start_zoning_guidance` is the admitted Service Desk Zoning Check
start capability. It accepts only the fixed Cincinnati jurisdiction, packaged
catalog ID, and one exact `catalogEntryId`; the stack resolves the provider
label, slug, description, and category path internally. Before creating a
provider project, it uses the read-only public Zoning search endpoint to prove
one exact provider fingerprint. Missing, ambiguous, or drifted entries fail
closed. The exact portal start control is allowed its normal client-render
window before the uniqueness guard runs; a missing or ambiguous control still
fails before project creation. `opencounter_start_guidance` remains temporarily
available for compatibility and is not admitted for the revised Zoning Check.

`opencounter_reconcile_zoning_start` is a separately versioned, low-level
same-project recovery primitive. It requires the exact normalized Zoning input
digest, revalidates the packaged catalog entry and live provider fingerprint,
cryptographically binds the encrypted session to that input and project, and
refuses a changed use, address, route, or reference. It never opens the provider
root or creates a replacement project and never supplies requester-owned guided
answers. A successful call returns the current bounded checkpoint or completed
result; a post-mutation uncertainty returns `indeterminate` and must never be
redispatched. This tool does not itself register or authorize a Service Desk
reconciler; Service Desk lifecycle use remains disabled until its separate
Owner command, durable fence, evidence, migration, and atomic transition
contract are implemented.

The packaged catalog is release configuration with tenant version `307` and
catalog-core SHA-256
`0fa60c5b7588d51676961de779f2757ed0fb99f58d8cd257ced313a941c26bf0`.
The stack validates the complete closed object and canonical digest at startup.

A successful anonymous guidance result is informational and remains subject
to final City staff review. A missing or expired state envelope, ambiguous
control, unexpected route, or provider UI drift fails closed rather than
starting a replacement project or choosing a nearby control.

Each requester checkpoint returns `checkpoint.checkpointSha256`. Continuation
must send that exact digest and answers for the active required questions. The
stack verifies the digest, question IDs, and single-select option values before
browser dispatch. On a same-project retry it inspects current provider values:
matching committed answers are not clicked again, while conflicting values fail
loudly without being overwritten. A blank resumed address field with a pending
`Select this address` transition is reconstructed from the encrypted exact
address checkpoint; it is never silently omitted.

Every MCP call returns the same bounded result in both JSON text content and
`structuredContent`, so a caller reading either channel receives the provider
reference, checkpoint digest, and exact address options.

Completed continuation returns `providerPdf` with validated artifact metadata
and the City summary source URL. Summary results also include
`evaluationScope: "selected_opencounter_land_use"` and the exact
`landUseCode`. This scope is important: OpenCounter's selected catalog use is
not automatically equivalent to a separately named zoning-code building form.
If independent code evidence conflicts with the OpenCounter classification,
downstream products must report conflicting City guidance and require City
Zoning staff confirmation rather than silently choosing either conclusion.
The downloaded PDF is preserved exactly as issued by OpenCounter. The current
provider template can repeat the Project Details questionnaire on a later page;
the adapter does not rewrite or normalize City-issued PDF content.

The adapter persists encrypted anonymous browser state as soon as the provider
exposes a project reference, before it waits for later use, location, or guided
question controls. A dependency timeout or UI failure after that boundary
returns bounded `indeterminate` evidence with the same project reference and
safe provider route. It never starts a replacement project automatically.
Missing, expired, or invalid resume state likewise returns bounded
`indeterminate` evidence for continuation, result reads, and reconciliation
instead of launching a browser without resumable state.

## Controlled question discovery

The package includes generic orchestration source for a deterministic local
discovery ledger that builds an **observed question library**. It is not an MCP
tool and not a claim that the provider questionnaire is exhaustive.

Only generic, portable, address-free definitions, source, documentation, and tests—and explicitly synthetic fixtures—may ship publicly for OpenCounter scenario waves.
Requester-approved previews and approvals, observation freezes,
exact source-ledger snapshots, parcel- and fact-specific evidence, and generated
scenario ledgers are private RUDI runtime state. Private state directories use
mode `0700`; files use mode `0600`.

An observation freeze is a private, content-addressed manifest. It may bind
rather than embed full source ledgers only when the exact snapshots are retained
immutably. The planner must canonicalize the source manifest before computing
`evidenceSetSha256`, rehash every retained snapshot, and require exact
no-extra/no-missing equality with the canonical source manifest. Planning must
fail closed when any snapshot is unavailable or mismatched.

Requester approval must bind `previewSha256` and the exact scenario ID, scenario
version, normalized question signature, answer value, and ownership tuple for
every rule. Approval for a site/location-derived rule must additionally bind the
exact frozen source-ledger snapshot cryptographically bound by the observation
freeze and fact-specific, parcel-specific evidence for the same parcel. Generic
fixture evidence, equality with an expected base-zone value, and membership in
the provider's displayed options are insufficient proof. Planning must fail
closed before any provider project starts if any rule lacks its required proof.

Answer rules have three closed ownership classes. `proposal_fact` is supplied
only by an explicitly synthetic coverage declaration. `site_fact` is supplied
only by a content-addressed parcel-specific evidence artifact. `mixed_fact`
requires both. Every proposal or mixed declaration says
`notRealProjectFact: true` and hashes the campaign and policy versions, scenario
and question signatures, and exact answer value. It is coverage input, never an
assertion about a requester's real project. A schema-v2 readiness report must
match every required site or mixed assertion exactly; missing, conflicting, or
unrelated historical artifacts cannot satisfy the gate.

### Branch-wave evidence contract

The 20-run first branch wave measures first-pass provider-question-ID coverage
only. Its terminal status is `scenario_wave_1_complete`; it does not measure
normalized-signature, answer-value, or transition coverage, cannot establish
answer-branch completeness, and must never produce or imply
`answer_branch_complete`.

The strongest defensible later empirical status is
`branch_frontier_stable_for_manifest(M)` as of a fixed observation epoch. `M`
is a private, content-addressed, requester-approved manifest that finitely
closes the exact catalog identity and entries; provider identity, fingerprint,
and version; exact verified location, context, base-zone, and overlay set; a
finite answer vocabulary that either excludes free text or enumerates every
allowed free-text value; maximum depth; per-wave and total project caps;
validity window; exact source-snapshot digests; and provenance for every answer
rule.

Every sweep freezes frontier `F_k`. A frontier cell is keyed by
`providerQuestionId` plus normalized signature, exact source-checkpoint
question set, the full prior answer prefix, complete answer vector, catalog
entry ID (`catalogEntryId`), and exact context key. It counts only when
authoritative provider read-back proves the exact next checkpoint set or
terminal result. A complete sweep covers every cell in `F_k` and leaves each
either at a verified terminal or at an explicitly approved out-of-scope
boundary. No queued, active, failed,
indeterminate, or unverified in-scope work may remain; in-scope `needs_input`
is incomplete.

A new question identity, option or value, transition, or in-scope context
association is novelty. Novelty resets the stability streak and requires a new
preview and approval. Provider, catalog, fingerprint, or context-evidence drift
invalidates `M`. Declare stability only after two independently executed and
separately authorized complete sweeps produce the same `M` digest and frontier
digest with zero novelty. Observations outside `M` do not reset the streak;
scope expansion versions `M` and restarts it. Reaching a cap yields
`wave_complete_scope_unsaturated`, never a global exhaustive or
answer-branch-complete claim.

`src/discovery-frontier-stability.mjs` makes that contract executable without
calling the provider. It validates and content-addresses the finite manifest,
one preview-bound authorized sweep, and the aggregate stability report. It
requires closed answer vocabulary and provenance, exact cell coverage,
verified-terminal or explicitly approved out-of-scope dispositions, distinct
authorization/preview/execution evidence for every sweep, and compliance with
the per-sweep and total project limits. Novelty remains version-blocking for
that manifest even if later runs repeat the old frontier. Private artifacts are
stored with directory mode `0700` and file mode `0600`.

The module cannot turn a structurally supplied authorization record into user
approval and cannot dispatch work. A real manifest must be derived from actual
post-Wave-1 evidence; until then only the contract itself is ready, not a
frontier campaign or stability claim.

The implementation enforces exact rule provenance, immutable source-snapshot
validation, content-addressed site evidence, preview-bound authorization, and
answer-dispatch validation. Building a preview is not authorization: none of
the 20 provider projects may execute until the requester explicitly approves
that exact `previewSha256` and volume.

### Master questionnaire and preliminary service flow

`src/discovery-master-questionnaire.mjs` derives a private,
content-addressed questionnaire from an exact observation freeze and every
retained source-ledger snapshot. Schema v3 groups normalized signatures into
provider-question families, marks family coverage as observed universal or
observed conditional, and preserves prompt/options, use and zoning
applicability, incoming conditions, outgoing answer transitions, terminal
classifications, evidence epochs, observation counts, and tenant/catalog
identity. Every transition carries the exact catalog entries, zones, overlays,
fixtures, and scenarios that produced it. Missing transitions remain unknown;
the artifact status is `first_pass_observed_non_exhaustive`.

`src/preliminary-guidance.mjs` is a pure, provider-free service-agent decision
boundary. It accepts the project idea and address, separately resolved
parcel/zoning evidence, requester-confirmed catalog-use candidates, and
provenance-bearing answers. It stages unresolved work locally, asks only
observed questions reachable for the selected use, and returns a preliminary
classification only when an exact use-scoped answer transition matches the
resolved zoning context. A missing branch, conflicting outcome, unobserved
zone/overlay, unclassified terminal, or stale catalog/questionnaire binding
fails to `insufficient_information`. Its OpenCounter confirmation field is a
recommendation only and always says `authorizationGranted: false`; the module
has no provider or City-staff call capability.

The flow deliberately does not perform NLP, geocoding, parcel resolution,
normative zoning-code evaluation, or physical-feasibility analysis. Those are
separate evidence producers and later phases. A preliminary result must not be
presented as a City determination.

`src/combined-project-assessment.mjs` defines the next boundary without copying
a site engine into this stack. A physical assessment must cover exactly five
evidence domains: development envelope; parking/access/loading/circulation;
utilities/infrastructure; topography/flood/environment; and existing-building
constraints. Findings cite content-addressed evidence and may include measured
values. Missing domain evidence yields `insufficient_information`; a different
parcel or rollup is rejected. The combined artifact always retains the legal
and physical classifications separately, then derives only a bounded
“potentially viable,” conditional, conflict, or insufficient conclusion.

`src/guidance-validation-maintenance.mjs` closes the provider-free maintenance
loop. Known-project cases bind exact provider read-back evidence to one
preliminary decision and report question true/false positives/negatives,
precision, recall, and classification accuracy with raw denominators. The same
module compares two validated questionnaire versions, reports added, removed,
and changed canonical questions, and derives the exact affected catalog-entry
set. Tenant or catalog drift recommends a full 126-entry refresh; evidence
changes may recommend a targeted rerun. Every drift report says
`authorizationGranted: false` and cannot dispatch those reruns.

`src/discovery-adaptive-zoning.mjs` derives a separate, address-free sampling
preview for zoning contexts that merit another observation. The versioned v1
policy binds the exact tenant and catalog, closes all 37 base-zone codes into
10 explicit sampling strata, and scores only observed first-pass signals:
Prohibited classifications, question-pattern divergence, terminal-outcome
divergence, and question signatures unique within an exact catalog category or
subgroup. Strata diversify sampling; they are not claims of legal or normative
zoning equivalence. The policy permits at most two new zones per use, 48 total
projects, and concurrency two. A caller may tighten those limits but cannot
loosen them under v1.

The preview is content-addressed private state and always has
`authorizationGranted: false`. Before an actually observed
`scenario_wave_1_complete` precursor it is provisional and must be regenerated;
afterward it may become ready for a new, separately bound authorization. A cap
or an empty candidate set is not saturation. Any stability claim still requires
two independently executed, separately authorized complete zero-novelty sweeps
of the same finite manifest.

The current catalog-wide first-pass definition is
`catalog/zoning-question-discovery-zone-portfolio-first-pass.json`. It selects
every entry from the digest-bound catalog at runtime and assigns the 126 stable
use-code jobs across a private, versioned portfolio of 37 Cincinnati base-zone
contexts. Round-robin assignment gives each context three or four jobs without
increasing the authorized project count. The public definition contains zoning
codes but no addresses. Each private location fixture retains the canonical
street address, parcel and rollup identities, expected and observed zoning,
overlay flags, boundary digest, and timestamped location evidence.

A location is admissible only after its complete parcel polygon is intersected
against Cincinnati's official CAGIS zoning layer. Scalar or point-derived
zoning is not enough: a parcel that crosses an incompatible base-zone polygon
must be replaced before any new provider start. Same-base suffixes such as
`T`, `P`, or `MH` may be retained as observed zoning context, but a different
base code fails the fixture audit.

This is pairwise sampling, not the exhaustive 126-by-37 matrix. Exercising every
use in every base zone would require 4,662 separately authorized projects before
any answer branching. Overlay combinations would add further contexts.

Planning requires a closed provider-volume authorization record with an exact
126-project limit. Each job uses the same empty-answer observation scenario.
The coordinator may queue the address checkpoint only when it contains exactly
one required `opencounter-address` question and exactly one normalized option
matches its assigned verified location. Street-suffix abbreviations and the
provider's appended Cincinnati/ZIP text are normalized before matching. Every
substantive or ambiguous question stays
`needs_input`; it is never answered by inference. Do not place real locations
or private runtime artifacts in this public package. Persist them beneath a
private absolute local state directory, such as the operator's RUDI state
directory.

`catalog/residential-question-discovery-pilot.json` remains the schema-v1
18-job calibration fixture. It is not the catalog-wide discovery target.

The coordinator-facing modules are:

```text
src/discovery-plan.mjs           # validate one location and plan all 126 jobs
src/discovery-zoning-portfolio.mjs # assign 126 uses across 37 zoning contexts
src/discovery-pilot.mjs          # retained 18-job calibration planner
src/discovery-ledger.mjs         # lease and enforce legal job transitions
src/discovery-controller.mjs     # enforce dispatch, read-back and stop sequencing
src/discovery-dispatch.mjs       # map persisted intent to one exact stack tool
src/discovery-ledger-store.mjs   # restrictive atomic JSON persistence and locking
src/discovery-question-graph.mjs # derive normalized question nodes and answer edges
src/discovery-master-questionnaire.mjs # derive versioned observed-only intake library
src/preliminary-guidance.mjs    # evaluate a provider-free preliminary decision flow
src/combined-project-assessment.mjs # combine separate legal and physical evidence
src/guidance-validation-maintenance.mjs # score known cases and plan drift reruns
src/discovery-adaptive-zoning.mjs # prioritize bounded cross-zone observations
src/discovery-frontier-stability.mjs # validate finite sweeps and stability
src/guidance-question-observer.mjs # inspect bounded provider question controls
```

The durable job states are:

| State | Meaning | Legal next step |
|---|---|---|
| `queued` | A validated start, continuation, or reconciliation is ready | Lease to one worker |
| `active` | One worker holds the unexpired exclusive lease | Persist dispatch intent, then record one result or failure |
| `needs_input` | The exact active checkpoint has no authorized complete answer set | Queue exact requester-approved or scenario-fixture answers |
| `completed` | A terminal provider result was observed | None |
| `indeterminate` | A provider effect may have occurred | Queue same-project reconciliation only when a provider reference exists; one fenced retry is allowed only after read-only proof that provider HTML access recovered |
| `failed` | A known no-effect failure was observed | Operator review; one explicitly fenced pre-effect retry is allowed only after the matching provider-contract fix is verified |

Before any provider call, the worker must persist `beginDiscoveryDispatch` for
the leased job. If its lease expires before that intent, the job can return to
the queue. If the lease expires after intent, the job becomes `indeterminate`
and cannot be selected as a new start. `queueDiscoveryReconciliation` replaces
an uncertain catalog start with the same-project `reconcile_start` input,
including the original catalog-bound provider-input digest. An uncertain
continuation retains its exact submitted answers while using same-project
guidance reconciliation. Neither path creates a replacement project, and
reconciliation itself is not retried automatically. A previously indeterminate
`reconcile_start`, or a same-project `reconcile` that preserves an uncertain
continuation, may be requeued once with `provider_html_access_restored` only
when the exact provider reference and reconciliation action are unchanged. A
separately evidenced
`provider_module_reload_verified` retry is allowed only after that first retry
was consumed by a verified stale stack process and remains restricted to the
digest-bound start-reconciliation shape, again without changing the project or
digest. Provider HTTP failures are rejected before an error page can be
interpreted as questionnaire state.

A no-project `opencounter_start_control_missing` failure may be requeued once
with `portal_start_control_render_verified` after the bounded render-wait fix is
installed. The retry requires the original `start` action, null provider
reference, known `none` effect, released lease, and unchanged job identity.

If the exact bounded result of an original catalog start becomes available only
after its worker lease expires but before stale-lease reclamation, the
coordinator may use the separate late-result transition. That transition does
not renew the lease or create a project: it requires the unchanged original
dispatch request, worker and lease token, an actually expired lease, the
persisted `start` mutation intent, and a non-null provider reference. The result
still passes the normal bounded-result validator and must receive the same
provider read-back verification as an on-time result. Early, mismatched,
reference-free, non-start, and already-transitioned inputs fail closed.

Provider read-back verification normally requires the exact observed
checkpoint digest. One narrow reconciliation is allowed when an unverified,
unanswered `needs_input` checkpoint is followed by an authoritative read-back
whose questions are a strict superset: every provisional question must still be
present with an identical ID, prompt, type, required flag, and options, and the
read-back must add at least one question. The coordinator replaces that one
provisional observation, records
`provider_read_back_checkpoint_reconciled`, and then verifies the fuller
checkpoint. Removed or changed questions, queued answers, prior verification,
terminal drift, and non-expanding mismatches still fail closed.
Queued continuation and reconciliation work is leased before any new `start`,
so an unresolved existing project cannot be skipped in favor of another one.
Once a worker queues follow-up work for its project, it reacquires that exact
non-start job through the job-affine controller operation instead of taking the
next global recovery lease.

The store validates the entire durable ledger on every read, recomputes stable
job and ledger identities from the catalog, location fixture, scenario,
provider-input digest and authorization, rejects symbolic links, writes with
mode `0600`, and refreshes the question graph from observation evidence.
Verified terminal zoning is compared with the job's assigned base zoning. Any
missing, unparseable, or incompatible result fences every new `start` lease
while still allowing queued same-project recovery work.
The terminal parser accepts a canonical zoning code either alone in the final
parenthesis or before the provider's spaced descriptive suffix; the extracted
code must still pass the closed code pattern and assigned-base comparison.
A corrected private
portfolio is executed through a digest-bound residual ledger containing only
catalog jobs for which the source ledger has no persisted
`start_dispatch_started` evidence; consumed projects are never replanned.
Question nodes combine the exact provider question ID with a normalized
prompt/type/options signature. Edges record the exact answer value followed by
the next observed question or a terminal result, plus first/last timestamps and
independent observation counts. Catalog-wide jobs also retain a matching
`get_guidance_result` read-back as verification evidence.

With four agent slots, the intended pool is one coordinator, two provider
runners, and one validator. The campaign enforces a maximum of two active
provider jobs even if more workers request leases. PDF export is not part of
discovery. Stop the pool on tenant/catalog drift, malformed controls, expired
encrypted provider state, an address mismatch, or an unknown substantive
answer.
