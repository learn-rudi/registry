import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
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
