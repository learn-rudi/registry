import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createOpenCounterArtifactStore } from "../src/artifact-store.mjs";

test("persists a bounded PDF content-addressably and rejects non-PDF bytes", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "opencounter-artifact-test-"));
  const artifactDirectory = path.join(temporaryRoot, "artifacts");
  const downloadPath = path.join(temporaryRoot, "provider-download");
  const invalidPath = path.join(temporaryRoot, "invalid-download");
  try {
    const bytes = Buffer.from("%PDF-1.7\nexample provider artifact\n", "utf8");
    await writeFile(downloadPath, bytes);
    await writeFile(invalidPath, Buffer.from("not a pdf", "utf8"));
    const store = createOpenCounterArtifactStore({ artifactDirectory, maxBytes: 1_024 });

    const artifact = await store.persistPdf({
      downloadPath,
      providerReference: "opencounter:project:2818724"
    });

    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    assert.equal(artifact.artifactRef, `rudi-artifact:opencounter:${artifact.sha256}`);
    assert.equal(artifact.fileName, `opencounter-project-2818724-${artifact.sha256}.pdf`);
    assert.equal(artifact.localPath, path.join(artifactDirectory, artifact.fileName));
    assert.equal(artifact.mediaType, "application/pdf");
    assert.equal(artifact.sizeBytes, bytes.length);
    assert.deepEqual(await readFile(artifact.localPath), bytes);
    assert.equal((await stat(artifact.localPath)).mode & 0o777, 0o600);

    await assert.rejects(
      store.persistPdf({
        downloadPath: invalidPath,
        providerReference: "opencounter:project:2818724"
      }),
      /not a PDF/
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("rejects a symbolic link at the content-addressed artifact destination", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "opencounter-artifact-symlink-test-"));
  const artifactDirectory = path.join(temporaryRoot, "artifacts");
  const downloadPath = path.join(temporaryRoot, "provider-download");
  const linkTarget = path.join(temporaryRoot, "outside-artifact.pdf");
  try {
    const bytes = Buffer.from("%PDF-1.7\nexample provider artifact\n", "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fileName = `opencounter-project-2818724-${sha256}.pdf`;
    await mkdir(artifactDirectory);
    await writeFile(downloadPath, bytes);
    await writeFile(linkTarget, bytes);
    await symlink(linkTarget, path.join(artifactDirectory, fileName));
    const store = createOpenCounterArtifactStore({ artifactDirectory, maxBytes: 1_024 });

    await assert.rejects(
      store.persistPdf({
        downloadPath,
        providerReference: "opencounter:project:2818724"
      }),
      /regular file/
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});
