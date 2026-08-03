import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEncryptedStateStore } from "../src/encrypted-state-store.mjs";

test("encrypts anonymous browser state at rest and restores it by opaque reference", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencounter-state-"));
  const store = createEncryptedStateStore({
    encryptionKey: Buffer.alloc(32, 7).toString("base64"),
    now: () => "2026-08-01T15:00:00.000Z",
    stateDirectory: directory
  });
  const reference = "opencounter:project:2818607";
  const state = { cookies: [{ name: "anonymous_session", value: "secret-cookie" }], origins: [] };
  await store.save(reference, state, "2026-08-02T15:00:00.000Z");
  const files = await import("node:fs/promises").then((fs) => fs.readdir(directory));
  const onDisk = await readFile(join(directory, files[0]), "utf8");
  assert.doesNotMatch(onDisk, /secret-cookie/);
  assert.deepEqual(await store.load(reference), state);
});

test("cryptographically binds resumable state to its project and exact provider input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencounter-bound-state-"));
  const store = createEncryptedStateStore({
    encryptionKey: Buffer.alloc(32, 8).toString("base64"),
    now: () => "2026-08-01T15:00:00.000Z",
    stateDirectory: directory
  });
  const reference = "opencounter:project:2819756";
  const otherReference = "opencounter:project:2819757";
  const bindingSha256 = "a".repeat(64);
  const state = { cookies: [{ name: "anonymous_session", value: "bounded" }] };

  await store.save(
    reference,
    state,
    "2026-08-02T15:00:00.000Z",
    bindingSha256
  );

  assert.deepEqual(
    await store.loadForReconciliation(reference, bindingSha256),
    { needsBindingMigration: false, storageState: state }
  );
  const continuedState = {
    cookies: [{ name: "anonymous_session", value: "continued" }]
  };
  await store.rewrite(
    reference,
    continuedState,
    "2026-08-03T15:00:00.000Z"
  );
  assert.deepEqual(
    await store.loadForReconciliation(reference, bindingSha256),
    { needsBindingMigration: false, storageState: continuedState }
  );
  await assert.rejects(
    store.loadForReconciliation(reference, "b".repeat(64)),
    /opencounter_resume_state_binding_mismatch/
  );

  const fileName = (value) => `${createHash("sha256").update(value).digest("hex")}.enc.json`;
  await copyFile(
    join(directory, fileName(reference)),
    join(directory, fileName(otherReference))
  );
  await assert.rejects(
    store.loadForReconciliation(otherReference, bindingSha256),
    /opencounter_resume_state_invalid/
  );
});

test("preserves the normalized requested address and immutable active checkpoint in encrypted state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencounter-guidance-state-"));
  const store = createEncryptedStateStore({
    encryptionKey: Buffer.alloc(32, 9).toString("base64"),
    now: () => "2026-08-03T15:00:00.000Z",
    stateDirectory: directory
  });
  const providerReference = "opencounter:project:2819848";
  const storageState = {
    cookies: [{ name: "anonymous_session", value: "session-secret" }]
  };
  const guidanceState = {
    activeCheckpoint: {
      checkpointSha256: "c".repeat(64),
      questions: [{
        id: "opencounter-address",
        options: [{
          label: "4818 Stewart Avenue, Cincinnati, Ohio 45227",
          value: "4818 Stewart Avenue, Cincinnati, Ohio 45227"
        }],
        prompt: "Which OpenCounter address match is the intended location?",
        required: true,
        type: "single_select"
      }]
    },
    requestedAddress: "4818 stewart avenue cincinnati oh"
  };

  await store.save(
    providerReference,
    storageState,
    "2026-08-04T15:00:00.000Z",
    "d".repeat(64),
    guidanceState
  );

  const files = await import("node:fs/promises").then((fs) => fs.readdir(directory));
  const onDisk = await readFile(join(directory, files[0]), "utf8");
  assert.doesNotMatch(onDisk, /4818|session-secret|opencounter-address/);
  assert.deepEqual(await store.loadSession(providerReference), {
    guidanceState,
    storageState
  });
});
