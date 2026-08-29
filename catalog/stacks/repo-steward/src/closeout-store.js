import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function comparableReceipt(value) {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.observed_at;
  delete copy.created_at;
  delete copy.updated_at;
  if (Array.isArray(copy.history)) {
    copy.history = copy.history.map(({ at: _at, ...event }) => event);
  }
  return JSON.stringify(copy);
}

export function createCloseoutStore({
  atomicWriteJson,
  ensureStateDirectory,
  readCloseout,
}) {
  async function atomicCreateJson(file, value) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(temporary, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.close();
      await fs.link(temporary, file);
      return true;
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== "EEXIST") throw error;
      return false;
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async function readBoundCloseout(paths) {
    let activeBytes;
    try {
      activeBytes = await fs.readFile(paths.active, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    let activeShape;
    try {
      activeShape = JSON.parse(activeBytes);
    } catch {
      throw new Error("Active closeout projection is not valid JSON.");
    }
    const version = activeShape?.version;
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new Error("Active closeout projection has no valid immutable version.");
    }
    const versionFile = path.join(paths.versionsRoot, `v${version}.json`);
    let immutableBytes;
    try {
      immutableBytes = await fs.readFile(versionFile, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(
          `Active closeout projection does not match immutable version: v${version}.`
        );
      }
      throw error;
    }
    if (activeBytes !== immutableBytes) {
      throw new Error(
        `Active closeout projection does not match immutable version: v${version}.`
      );
    }
    const immutable = await readCloseout(versionFile);
    if (!immutable) {
      throw new Error(`Unable to read immutable worktree closeout version ${version}.`);
    }
    return immutable;
  }

  async function persistVersion(paths, receipt) {
    await ensureStateDirectory(paths.versionsRoot);
    const versionFile = path.join(paths.versionsRoot, `v${receipt.version}.json`);
    const created = await atomicCreateJson(versionFile, receipt);
    if (!created) {
      let competing;
      try {
        competing = JSON.parse(await fs.readFile(versionFile, "utf8"));
      } catch {
        throw new Error(
          `Immutable closeout version conflict: ${receipt.receipt_id} v${receipt.version}.`
        );
      }
      if (comparableReceipt(competing) !== comparableReceipt(receipt)) {
        throw new Error(
          `Immutable closeout version conflict: ${receipt.receipt_id} v${receipt.version}.`
        );
      }
    }
    const immutable = await readCloseout(versionFile);
    if (!immutable) {
      throw new Error(`Unable to persist worktree closeout version ${receipt.version}.`);
    }
    await atomicWriteJson(paths.active, immutable);
    return immutable;
  }

  return { persistVersion, readBoundCloseout };
}
