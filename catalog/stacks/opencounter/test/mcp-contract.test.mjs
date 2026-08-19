import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from
  "@modelcontextprotocol/sdk/client/stdio.js";

import { createMasterQuestionnaireStore } from
  "../src/discovery-master-questionnaire.mjs";
import {
  catalog,
  questionnaire,
  request,
  selectedCatalogEntryId,
  siteContext
} from "./fixtures/preliminary-guidance-fixture.mjs";

const stackRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("publishes exactly the manifest-declared MCP tool surface", async () => {
  const rudiHome = await mkdtemp(path.join(
    os.tmpdir(),
    "opencounter-mcp-contract-"
  ));
  const manifest = JSON.parse(await readFile(
    path.join(stackRoot, "manifest.json"),
    "utf8"
  ));
  const client = new Client({
    name: "opencounter-contract-test",
    version: "1.0.0"
  });
  const transport = new StdioClientTransport({
    args: ["src/index.mjs"],
    command: process.execPath,
    cwd: stackRoot,
    env: {
      ...process.env,
      OPENCOUNTER_SESSION_ENCRYPTION_KEY:
        Buffer.alloc(32, 7).toString("base64"),
      RUDI_HOME: rudiHome
    }
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map(({ name }) => name).sort(),
      [...manifest.provides.tools].sort()
    );
  } finally {
    await client.close().catch(() => {});
    await rm(rudiHome, { force: true, recursive: true });
  }
});

test("executes assess_project through the public MCP boundary", async () => {
  const rudiHome = await mkdtemp(path.join(
    os.tmpdir(),
    "opencounter-mcp-assessment-"
  ));
  createMasterQuestionnaireStore({
    stateDirectory: path.join(rudiHome, "state", "opencounter-discovery")
  }).write(questionnaire);
  const client = new Client({
    name: "opencounter-assessment-test",
    version: "1.0.0"
  });
  const transport = new StdioClientTransport({
    args: ["src/index.mjs"],
    command: process.execPath,
    cwd: stackRoot,
    env: {
      ...process.env,
      OPENCOUNTER_SESSION_ENCRYPTION_KEY:
        Buffer.alloc(32, 11).toString("base64"),
      RUDI_HOME: rudiHome
    }
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      arguments: {
        address: request.address,
        answers: [],
        assessmentKey: "mcp:known-path:intake",
        confirmedCatalogEntryId: selectedCatalogEntryId,
        jurisdiction: "cincinnati-oh",
        observedAt: "2026-08-05T15:00:00.000Z",
        physicalAssessment: null,
        projectIdea: projectProviderLabel(selectedCatalogEntryId),
        questionnaireSha256: questionnaire.questionnaireSha256,
        schemaVersion: 1,
        siteResolution: {
          issues: [],
          siteContext: siteContext("SF-2"),
          status: "resolved"
        }
      },
      name: "opencounter_assess_project"
    });
    assert.equal(result.structuredContent.status, "needs_project_input");
    assert.equal(result.structuredContent.assessment.status,
      "needs_project_input");
    assert.equal(
      result.structuredContent.assessment.providerEscalation
        .authorizationGranted,
      false
    );
    assert.equal((await stat(result.structuredContent.artifact.path)).mode
      & 0o777, 0o600);
  } finally {
    await client.close().catch(() => {});
    await rm(rudiHome, { force: true, recursive: true });
  }
});

function projectProviderLabel(catalogEntryId) {
  for (const category of catalog.categories) {
    for (const entry of [
      ...category.entries,
      ...category.groups.flatMap((group) => group.entries)
    ]) {
      if (entry.catalogEntryId === catalogEntryId) return entry.providerLabel;
    }
  }
  throw new Error("test catalog entry missing");
}
