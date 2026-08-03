import { createHash, randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateProviderReference } from "./core.mjs";

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export function createOpenCounterArtifactStore({
  artifactDirectory,
  maxBytes = DEFAULT_MAX_BYTES
}) {
  if (typeof artifactDirectory !== "string" || !path.isAbsolute(artifactDirectory)) {
    throw new Error("OpenCounter artifact directory must be absolute.");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 5 || maxBytes > DEFAULT_MAX_BYTES) {
    throw new Error("OpenCounter artifact byte limit is invalid.");
  }
  const root = path.resolve(artifactDirectory);

  return {
    async persistPdf({ downloadPath, providerReference }) {
      const reference = validateProviderReference(providerReference);
      if (typeof downloadPath !== "string" || !path.isAbsolute(downloadPath)) {
        throw new Error("OpenCounter download path must be absolute.");
      }
      const downloadStat = await lstat(downloadPath);
      if (!downloadStat.isFile() || downloadStat.size < 5 || downloadStat.size > maxBytes) {
        throw new Error("OpenCounter PDF size is invalid.");
      }
      const bytes = await readFile(downloadPath);
      if (bytes.length !== downloadStat.size || bytes.length > maxBytes) {
        throw new Error("OpenCounter PDF changed while it was being read.");
      }
      if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new Error("OpenCounter download is not a PDF.");
      }

      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const projectId = reference.split(":").pop();
      const fileName = `opencounter-project-${projectId}-${sha256}.pdf`;
      const localPath = path.join(root, fileName);
      await mkdir(root, { mode: 0o700, recursive: true });
      await chmod(root, 0o700);
      await persistAtomically({ bytes, localPath, root, sha256 });
      return {
        artifactRef: `rudi-artifact:opencounter:${sha256}`,
        fileName,
        localPath,
        mediaType: "application/pdf",
        sha256,
        sizeBytes: bytes.length
      };
    }
  };
}

async function persistAtomically({ bytes, localPath, root, sha256 }) {
  const temporaryPath = path.join(root, `.opencounter-${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    try {
      await link(temporaryPath, localPath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existingStat = await lstat(localPath);
      if (!existingStat.isFile()) {
        throw new Error("Existing OpenCounter artifact is not a regular file.");
      }
      const existing = await readFile(localPath);
      const existingSha256 = createHash("sha256").update(existing).digest("hex");
      if (existingSha256 !== sha256) {
        throw new Error("Existing OpenCounter artifact failed digest verification.");
      }
    }
    await chmod(localPath, 0o600);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}
