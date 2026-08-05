import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildVerifiedObservationPortfolio,
  createVerifiedObservationPortfolioStore,
  createVerifiedObservationSnapshotStore,
  validateVerifiedObservationPortfolio,
  validateVerifiedObservationPortfolioSources
} from "../src/discovery-observation-portfolio.mjs";
import { loadZoningCatalog } from "../src/zoning-catalog.mjs";

const catalog = loadZoningCatalog(new URL(
  "../catalog/cincinnati-opencounter-zoning-use-catalog-v1.json",
  import.meta.url
));

test("freezes one verified observation for every catalog entry across source ledgers", () => {
  const entries = flattenCatalogEntries(catalog);
  const ledgers = [
    createObservationLedger("source", entries.slice(0, 8)),
    createObservationLedger("residual", entries.slice(8))
  ];

  const first = buildVerifiedObservationPortfolio({
    catalog,
    frozenAt: "2026-08-04T20:00:00.000Z",
    ledgers
  });
  const second = buildVerifiedObservationPortfolio({
    catalog,
    frozenAt: "2026-08-04T20:00:00.000Z",
    ledgers
  });
  const reversed = buildVerifiedObservationPortfolio({
    catalog,
    frozenAt: "2026-08-04T20:00:00.000Z",
    ledgers: [...ledgers].reverse()
  });

  assert.equal(first.freezeId, second.freezeId);
  assert.equal(first.freezeId, reversed.freezeId);
  assert.deepEqual(first.sourceLedgers, reversed.sourceLedgers);
  assert.equal(first.coverage.catalogEntryCount, 126);
  assert.equal(first.coverage.verifiedObservationCount, 126);
  assert.deepEqual(first.coverage.statusCounts, {
    completed: 0,
    needs_input: 126
  });
  assert.equal(first.questionGraph.questions.length, 1);
  assert.equal(
    first.questionGraph.questions[0].independentObservationCount,
    126
  );
  assert.equal(first.questionGraph.edges.length, 0);
  assert.deepEqual(
    first.sourceLedgers.map(({ verifiedObservationCount }) =>
      verifiedObservationCount),
    [8, 118]
  );
});

test("persists and validates a content-addressed freeze with private permissions", () => {
  const entries = flattenCatalogEntries(catalog);
  const freeze = buildVerifiedObservationPortfolio({
    catalog,
    frozenAt: "2026-08-04T20:00:00.000Z",
    ledgers: [
      createObservationLedger("source", entries.slice(0, 8)),
      createObservationLedger("residual", entries.slice(8))
    ]
  });
  const stateDirectory = mkdtempSync(path.join(
    tmpdir(),
    "opencounter-observation-freeze-"
  ));
  try {
    const store = createVerifiedObservationPortfolioStore({ stateDirectory });
    const written = store.write(freeze);
    const persisted = store.read(freeze.freezeId);

    assert.equal(written.freezeId, freeze.freezeId);
    assert.equal(statSync(written.path).mode & 0o777, 0o600);
    assert.deepEqual(persisted, freeze);
    assert.deepEqual(store.write(freeze), written);
    assert.deepEqual(
      createVerifiedObservationPortfolioStore({ stateDirectory }).read(freeze.freezeId),
      freeze
    );
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("requires the exact canonical source snapshots bound by the freeze", () => {
  const entries = flattenCatalogEntries(catalog);
  const ledgers = [
    createObservationLedger("source", entries.slice(0, 8)),
    createObservationLedger("residual", entries.slice(8))
  ];
  const freeze = buildVerifiedObservationPortfolio({
    catalog,
    frozenAt: "2026-08-04T20:00:00.000Z",
    ledgers
  });

  assert.deepEqual(validateVerifiedObservationPortfolio({ catalog, freeze }), freeze);
  assert.deepEqual(validateVerifiedObservationPortfolioSources({
    catalog,
    freeze,
    ledgers: [...ledgers].reverse()
  }), freeze);

  const mutated = structuredClone(ledgers);
  mutated[0].snapshotMutation = true;
  assert.throws(() => validateVerifiedObservationPortfolioSources({
    catalog,
    freeze,
    ledgers: mutated
  }), /source_snapshot_mismatch/);
  assert.throws(() => validateVerifiedObservationPortfolioSources({
    catalog,
    freeze,
    ledgers: ledgers.slice(0, 1)
  }), /source_snapshot_mismatch/);
  assert.throws(() => validateVerifiedObservationPortfolioSources({
    catalog,
    freeze,
    ledgers: [...ledgers, structuredClone(ledgers[0])]
  }), /source_snapshot_mismatch/);

  const tamperedFreeze = structuredClone(freeze);
  tamperedFreeze.evidenceSetSha256 = digest("tampered-evidence-set");
  assert.throws(() => validateVerifiedObservationPortfolio({
    catalog,
    freeze: tamperedFreeze
  }), /freeze|evidence/i);
});

test("retains content-addressed source snapshots immutably with private permissions", () => {
  const entries = flattenCatalogEntries(catalog);
  const ledger = createObservationLedger("source", entries.slice(0, 8));
  const stateDirectory = mkdtempSync(path.join(
    tmpdir(),
    "opencounter-observation-snapshot-"
  ));
  try {
    const store = createVerifiedObservationSnapshotStore({ stateDirectory });
    const first = store.write(ledger);
    const repeated = store.write(structuredClone(ledger));

    assert.deepEqual(repeated, first);
    assert.equal(statSync(first.path).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(first.path)).mode & 0o777, 0o700);
    assert.deepEqual(store.read(first.ledgerSnapshotSha256), ledger);

    const changedLedger = structuredClone(ledger);
    changedLedger.snapshotMutation = true;
    const changed = store.write(changedLedger);
    assert.notEqual(changed.ledgerSnapshotSha256, first.ledgerSnapshotSha256);
    assert.deepEqual(store.read(first.ledgerSnapshotSha256), ledger);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("rejects duplicate, incomplete, unresolved, or unverified observation sets", () => {
  const entries = flattenCatalogEntries(catalog);
  const createLedgers = () => [
    createObservationLedger("source", entries.slice(0, 8)),
    createObservationLedger("residual", entries.slice(8))
  ];
  const build = (ledgers) => buildVerifiedObservationPortfolio({
    catalog,
    frozenAt: "2026-08-04T20:00:00.000Z",
    ledgers
  });

  const duplicate = createLedgers();
  duplicate[1].jobs[0].catalogEntryId = duplicate[0].jobs[0].catalogEntryId;
  assert.throws(() => build(duplicate), /catalog_entry_duplicate/);

  const incomplete = createLedgers();
  incomplete[1].jobs.pop();
  assert.throws(() => build(incomplete), /coverage_incomplete/);

  const unresolved = createLedgers();
  unresolved[1].jobs[0].status = "indeterminate";
  assert.throws(() => build(unresolved), /unresolved_job/);

  const unverified = createLedgers();
  unverified[1].jobs[0].verification = null;
  assert.throws(() => build(unverified), /verification_missing/);
});

function createObservationLedger(label, entries) {
  const observedAt = "2026-08-04T19:00:00.000Z";
  const providerProjectBase = label === "source" ? 2_900_000 : 2_910_000;
  const questions = [{
    id: "existing_use",
    options: [
      { label: "Yes", value: "Yes" },
      { label: "No", value: "No" }
    ],
    prompt: "Does this use already exist?",
    required: true,
    type: "single_select"
  }];
  const jobs = entries.map(({ catalogEntryId, categoryPath }, index) => {
    const checkpointSha256 = digest(`${label}:checkpoint:${index}`);
    const providerReference = `opencounter:project:${providerProjectBase + index}`;
    return {
      catalogEntryId,
      categoryPath,
      checkpoint: {
        checkpointSha256,
        expiresAt: "2026-08-05T19:00:00.000Z",
        questions,
        schemaVersion: 1
      },
      jobId: `ocdj_${digest(`${label}:job:${index}`)}`,
      locationFixture: {
        expectedBaseZoningCode: "SF-2",
        locationId: `${label}-fixture-${index}`,
        locationVersion: 1,
        observedZoningCode: "SF-2",
        overlayFlags: []
      },
      observations: [{
        answers: [],
        checkpointSha256,
        observedAt,
        operation: "start",
        questions,
        resultStatus: "needs_requester_input"
      }],
      providerReference,
      scenario: {
        answerRules: [],
        assumptions: {},
        scenarioId: "first-pass-question-observation",
        scenarioVersion: 1
      },
      status: "needs_input",
      terminalResult: null,
      verification: {
        checkpointSha256,
        observedAt,
        providerReference,
        status: "needs_requester_input"
      }
    };
  });
  return {
    catalog: {
      catalogId: catalog.catalogId,
      catalogSha256: catalog.catalogSha256,
      tenantId: catalog.provider.tenantId,
      tenantVersion: catalog.provider.tenantVersion
    },
    jobs,
    ledgerId: `ocdl_${digest(`${label}:ledger-id`)}`,
    ledgerSha256: digest(`${label}:ledger-identity`),
    schemaVersion: 4
  };
}

function flattenCatalogEntries(value) {
  return value.categories.flatMap((category) => [
    ...category.entries.map((entry) => ({
      catalogEntryId: entry.catalogEntryId,
      categoryPath: [category.label]
    })),
    ...category.groups.flatMap((group) => group.entries.map((entry) => ({
      catalogEntryId: entry.catalogEntryId,
      categoryPath: [category.label, group.label]
    })))
  ]).sort((left, right) =>
    left.catalogEntryId.localeCompare(right.catalogEntryId));
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
