import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname } from "node:path";
import { pipeline } from "node:stream/promises";

export const DRIVE_FILE_FIELDS = [
  "id",
  "name",
  "mimeType",
  "driveId",
  "parents",
  "size",
  "createdTime",
  "modifiedTime",
  "webViewLink",
  "webContentLink",
  "resourceKey",
  "sha256Checksum",
  "md5Checksum",
  "trashed",
  "capabilities(canDownload,canEdit,canMoveItemWithinDrive)",
].join(",");

type DriveFile = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  driveId?: string | null;
  parents?: string[] | null;
  size?: string | null;
  createdTime?: string | null;
  modifiedTime?: string | null;
  webViewLink?: string | null;
  webContentLink?: string | null;
  resourceKey?: string | null;
  sha256Checksum?: string | null;
  md5Checksum?: string | null;
  trashed?: boolean | null;
  capabilities?: Record<string, boolean | null | undefined> | null;
};

type DriveListResponse = {
  files?: DriveFile[] | null;
  nextPageToken?: string | null;
  incompleteSearch?: boolean | null;
};

export type DriveClientLike = {
  files: {
    list(params: Record<string, unknown>): Promise<{ data: DriveListResponse }>;
    create?(params: Record<string, unknown>): Promise<{ data: DriveFile }>;
    get?(
      params: Record<string, unknown>,
      options?: Record<string, unknown>
    ): Promise<{ data: DriveFile | NodeJS.ReadableStream }>;
    update?(params: Record<string, unknown>): Promise<{ data: DriveFile }>;
    delete?(params: Record<string, unknown>): Promise<{ data: unknown }>;
  };
  permissions?: {
    create(params: Record<string, unknown>): Promise<{ data: unknown }>;
  };
};

export type DriveDependencies = {
  resolveAccount(args: Record<string, unknown>): string | null;
  getDrive(account: string | null): DriveClientLike;
};

type DriveToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
};

export function buildDriveListParams(args: Record<string, unknown>) {
  const query = optionalString(args.query, "query");
  const pageToken = optionalString(args.page_token, "page_token");
  const driveId = optionalString(args.drive_id, "drive_id");
  const corpora = optionalEnum(args.corpora, "corpora", ["user", "drive", "domain", "allDrives"]);

  if (corpora === "drive" && !driveId) {
    throw new Error("drive_id is required when corpora is drive");
  }
  if (driveId && corpora && corpora !== "drive") {
    throw new Error("corpora must be drive when drive_id is provided");
  }

  const effectiveCorpora = driveId ? "drive" : corpora;
  const params: Record<string, unknown> = {
    pageSize: boundedInteger(args.max_results, "max_results", 20, 1, 1000),
    supportsAllDrives: true,
    fields: `nextPageToken,incompleteSearch,files(${DRIVE_FILE_FIELDS})`,
  };
  if (query) params.q = query;
  if (pageToken) params.pageToken = pageToken;
  if (driveId) params.driveId = driveId;
  if (effectiveCorpora) params.corpora = effectiveCorpora;
  if (effectiveCorpora === "drive" || effectiveCorpora === "allDrives") {
    params.includeItemsFromAllDrives = true;
  }
  return params;
}

export async function handleDriveTool(
  name: string,
  args: Record<string, unknown> | undefined,
  dependencies: DriveDependencies
): Promise<DriveToolResult | undefined> {
  const toolArgs = args || {};
  if (!["drive_list", "drive_upload", "drive_update", "drive_create_folder", "drive_move_file", "drive_download", "drive_make_public", "drive_delete"].includes(name)) return undefined;

  if ((name === "drive_make_public" || name === "drive_delete") && toolArgs.drive_id != null) {
    throw new Error(`${name} does not support Shared Drive operations`);
  }
  if (toolArgs.drive_id != null && (typeof toolArgs.account !== "string" || toolArgs.account.trim() === "")) {
    throw new Error("account is required when drive_id is provided");
  }
  if (toolArgs.corpora === "allDrives" && (typeof toolArgs.account !== "string" || toolArgs.account.trim() === "")) {
    throw new Error("account is required when corpora is allDrives");
  }

  const account = dependencies.resolveAccount(toolArgs);
  const drive = dependencies.getDrive(account);

  if (name === "drive_list") {
    const params = buildDriveListParams(toolArgs);
    const response = await drive.files.list(params);
    const files = response.data.files || [];
    const driveId = optionalString(toolArgs.drive_id, "drive_id");
    const structuredFiles = files.map((file) => normalizeDriveFile(file, account, driveId));
    const structuredContent: Record<string, unknown> = {
      provider: "google-drive",
      account,
      ...(driveId ? { driveId } : {}),
      files: structuredFiles,
      ...(response.data.nextPageToken ? { nextPageToken: response.data.nextPageToken } : {}),
      incompleteSearch: response.data.incompleteSearch === true,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
      structuredContent,
    };
  }

  if (name === "drive_create_folder") {
    const folderName = requireString(toolArgs.name, "name");
    const driveId = optionalString(toolArgs.drive_id, "drive_id");
    const parentId = optionalString(toolArgs.parent_id, "parent_id") || driveId;
    const collisionPolicy = optionalEnum(
      toolArgs.collision_policy,
      "collision_policy",
      ["create_new", "fail", "reuse"]
    ) || (driveId ? "fail" : "create_new");
    if (parentId) {
      await validateDestinationFolder(drive, parentId, driveId, account);
    }

    if (collisionPolicy !== "create_new") {
      const collisions = await findExactDriveFiles(drive, {
        parentId: parentId || "root",
        name: folderName,
        driveId,
        mimeType: "application/vnd.google-apps.folder",
      });
      if (collisions.length > 1) {
        throw new Error(`Folder creation is ambiguous: ${collisions.length} folders named '${folderName}' exist in the exact parent`);
      }
      if (collisions.length === 1) {
        const collision = collisions[0];
        if (collisionPolicy === "fail") {
          throw new Error(`A folder named '${folderName}' already exists in the exact parent`);
        }
        return {
          content: [{ type: "text", text: JSON.stringify(collision) }],
          structuredContent: {
            provider: "google-drive",
            operation: "create_folder",
            account,
            ...(driveId ? { driveId } : {}),
            created: false,
            reused: true,
            file: normalizeDriveFile(collision, account, driveId),
          },
        };
      }
    }

    if (!drive.files.create) throw new Error("Google Drive create operation is unavailable");
    const response = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        ...(parentId ? { parents: [parentId] } : {}),
      },
      supportsAllDrives: true,
      fields: DRIVE_FILE_FIELDS,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(response.data) }],
      structuredContent: {
        provider: "google-drive",
        operation: "create_folder",
        account,
        ...(driveId ? { driveId } : {}),
        created: true,
        reused: false,
        file: normalizeDriveFile(response.data, account, driveId),
      },
    };
  }

  if (name === "drive_update") {
    const fileId = requireString(toolArgs.file_id, "file_id");
    const filePath = requireRegularFile(toolArgs.file_path, "file_path");
    const replacementName = optionalString(toolArgs.name, "name");
    const driveId = optionalString(toolArgs.drive_id, "drive_id");
    if (!drive.files.update) throw new Error("Google Drive update operation is unavailable");
    if (!drive.files.get) throw new Error("Google Drive get operation is unavailable");
    const current = await drive.files.get({
      fileId,
      supportsAllDrives: true,
      fields: DRIVE_FILE_FIELDS,
    });
    normalizeDriveFileForScope(current.data as DriveFile, account, driveId);

    const localSha256 = await hashFileSha256(filePath);
    const response = await drive.files.update({
      fileId,
      requestBody: replacementName ? { name: replacementName } : undefined,
      media: { body: createReadStream(filePath) },
      supportsAllDrives: true,
      fields: DRIVE_FILE_FIELDS,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
      structuredContent: {
        provider: "google-drive",
        operation: "update",
        account,
        ...(driveId ? { driveId } : {}),
        localSha256,
        file: normalizeDriveFile(response.data, account, driveId),
      },
    };
  }

  if (name === "drive_move_file") {
    const fileId = requireString(toolArgs.file_id, "file_id");
    const newParentId = requireString(toolArgs.new_parent_id, "new_parent_id");
    const driveId = optionalString(toolArgs.drive_id, "drive_id");
    if (!drive.files.get) throw new Error("Google Drive get operation is unavailable");
    await validateDestinationFolder(drive, newParentId, driveId, account);
    const current = await drive.files.get({
      fileId,
      supportsAllDrives: true,
      fields: DRIVE_FILE_FIELDS,
    });
    const currentData = current.data as DriveFile;
    const currentFile = normalizeDriveFileForScope(currentData, account, driveId);
    const parents = currentData.parents || [];
    if (parents.includes(newParentId)) {
      return {
        content: [{ type: "text", text: JSON.stringify(currentData) }],
        structuredContent: {
          provider: "google-drive",
          operation: "move",
          account,
          ...(driveId ? { driveId } : {}),
          moved: false,
          noOp: true,
          file: currentFile,
        },
      };
    }

    if (!drive.files.update) throw new Error("Google Drive update operation is unavailable");
    const response = await drive.files.update({
      fileId,
      addParents: newParentId,
      ...(parents.length > 0 ? { removeParents: parents.join(",") } : {}),
      supportsAllDrives: true,
      fields: DRIVE_FILE_FIELDS,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(response.data) }],
      structuredContent: {
        provider: "google-drive",
        operation: "move",
        account,
        ...(driveId ? { driveId } : {}),
        moved: true,
        noOp: false,
        file: normalizeDriveFile(response.data, account, driveId),
      },
    };
  }

  if (name === "drive_download") {
    const fileId = requireString(toolArgs.file_id, "file_id");
    const outputPath = requireString(toolArgs.output_path, "output_path");
    const driveId = optionalString(toolArgs.drive_id, "drive_id");
    if (!drive.files.get) throw new Error("Google Drive get operation is unavailable");
    const metadata = await drive.files.get({
      fileId,
      supportsAllDrives: true,
      fields: DRIVE_FILE_FIELDS,
    });
    const metadataFile = metadata.data as DriveFile;
    const file = normalizeDriveFileForScope(metadataFile, account, driveId);
    if (metadataFile.capabilities?.canDownload === false) {
      throw new Error(`Drive file '${fileId}' cannot be downloaded by the selected account`);
    }
    if (metadataFile.mimeType?.startsWith("application/vnd.google-apps.")) {
      throw new Error(`Drive file '${fileId}' is not stored blob content; native Google file export is not supported`);
    }

    mkdirSync(dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.rudi-${process.pid}-${randomUUID()}.tmp`;
    try {
      const response = await drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "stream" }
      );
      await pipeline(response.data as NodeJS.ReadableStream, createWriteStream(temporaryPath));
      const stat = statSync(temporaryPath);
      const sha256 = await hashFileSha256(temporaryPath);
      renameSync(temporaryPath, outputPath);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ path: outputPath, bytes: stat.size, sha256 }),
        }],
        structuredContent: {
          provider: "google-drive",
          operation: "download",
          account,
          ...(driveId ? { driveId } : {}),
          path: outputPath,
          bytes: stat.size,
          sha256,
          file,
        },
      };
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch (cleanupError) {
        if (!isNodeErrorWithCode(cleanupError, "ENOENT")) throw cleanupError;
      }
      throw error;
    }
  }

  if (name === "drive_make_public") {
    const fileId = requireString(toolArgs.file_id, "file_id");
    if (!drive.files.get) throw new Error("Google Drive get operation is unavailable");
    if (!drive.permissions) throw new Error("Google Drive permissions operation is unavailable");
    const metadata = await drive.files.get({
      fileId,
      supportsAllDrives: true,
      fields: DRIVE_FILE_FIELDS,
    });
    const metadataFile = metadata.data as DriveFile;
    if (metadataFile.driveId) {
      throw new Error("drive_make_public does not support Shared Drive operations");
    }
    normalizeDriveFileForScope(metadataFile, account);
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });
    const publicUrl = `https://drive.google.com/uc?id=${fileId}`;
    return {
      content: [{ type: "text", text: `File is now public.\nDirect URL: ${publicUrl}` }],
      structuredContent: {
        provider: "google-drive",
        operation: "make_public",
        account,
        fileId,
        publicUrl,
      },
    };
  }

  if (name === "drive_delete") {
    const fileId = requireString(toolArgs.file_id, "file_id");
    if (!drive.files.get) throw new Error("Google Drive get operation is unavailable");
    if (!drive.files.delete) throw new Error("Google Drive delete operation is unavailable");
    const metadata = await drive.files.get({
      fileId,
      supportsAllDrives: true,
      fields: DRIVE_FILE_FIELDS,
    });
    const metadataFile = metadata.data as DriveFile;
    if (metadataFile.driveId) {
      throw new Error("drive_delete does not support Shared Drive operations");
    }
    normalizeDriveFileForScope(metadataFile, account);
    await drive.files.delete({ fileId });
    return {
      content: [{ type: "text", text: `Deleted file: ${fileId}` }],
      structuredContent: {
        provider: "google-drive",
        operation: "delete",
        account,
        fileId,
        deleted: true,
      },
    };
  }

  const filePath = requireRegularFile(toolArgs.file_path, "file_path");
  const fileName = optionalString(toolArgs.name, "name") || basename(filePath);
  const driveId = optionalString(toolArgs.drive_id, "drive_id");
  const folderId = optionalString(toolArgs.folder_id, "folder_id") || driveId;
  const collisionPolicy = optionalEnum(
    toolArgs.collision_policy,
    "collision_policy",
    ["create_new", "fail", "reuse_if_same"]
  ) || (driveId ? "fail" : "create_new");
  if (folderId) {
    await validateDestinationFolder(drive, folderId, driveId, account);
  }
  const localSha256 = await hashFileSha256(filePath);

  if (collisionPolicy !== "create_new") {
    const collisions = await findExactDriveFiles(drive, {
      parentId: folderId || "root",
      name: fileName,
      driveId,
    });
    if (collisions.length > 1) {
      throw new Error(`Upload is ambiguous: ${collisions.length} files named '${fileName}' exist in the exact parent`);
    }
    if (collisions.length === 1) {
      const collision = collisions[0];
      if (collisionPolicy === "fail") {
        throw new Error(`A file named '${fileName}' already exists in the exact parent`);
      }
      if (!collision.sha256Checksum || collision.sha256Checksum !== localSha256) {
        throw new Error(`A file named '${fileName}' exists but its SHA-256 does not match the local file`);
      }
      const file = normalizeDriveFile(collision, account, driveId);
      return {
        content: [{
          type: "text",
          text: `Reused: ${collision.webViewLink || requireProviderString(collision.id, "Drive file id")}`,
        }],
        structuredContent: {
          provider: "google-drive",
          operation: "upload",
          account,
          ...(driveId ? { driveId } : {}),
          created: false,
          reused: true,
          localSha256,
          file,
        },
      };
    }
  }

  if (!drive.files.create) throw new Error("Google Drive create operation is unavailable");
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      ...(folderId ? { parents: [folderId] } : {}),
    },
    media: { body: createReadStream(filePath) },
    supportsAllDrives: true,
    fields: DRIVE_FILE_FIELDS,
  });
  const file = normalizeDriveFile(response.data, account, driveId);
  return {
    content: [{
      type: "text",
      text: `Uploaded: ${response.data.webViewLink || requireProviderString(response.data.id, "Drive file id")}`,
    }],
    structuredContent: {
      provider: "google-drive",
      operation: "upload",
      account,
      ...(driveId ? { driveId } : {}),
      created: true,
      reused: false,
      localSha256,
      file,
    },
  };
}

export async function findExactDriveFiles(
  drive: DriveClientLike,
  options: {
    parentId: string;
    name: string;
    driveId?: string;
    mimeType?: string;
  }
): Promise<DriveFile[]> {
  const parentId = requireString(options.parentId, "parentId");
  const name = requireString(options.name, "name");
  const driveId = optionalString(options.driveId, "driveId");
  const mimeType = optionalString(options.mimeType, "mimeType");
  const query = [
    `'${escapeDriveQueryLiteral(parentId)}' in parents`,
    `name = '${escapeDriveQueryLiteral(name)}'`,
    "trashed = false",
    ...(mimeType ? [`mimeType = '${escapeDriveQueryLiteral(mimeType)}'`] : []),
  ].join(" and ");
  const files: DriveFile[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;

  for (let page = 0; page < 100; page += 1) {
    const params: Record<string, unknown> = {
      q: query,
      pageSize: 100,
      supportsAllDrives: true,
      fields: `nextPageToken,files(${DRIVE_FILE_FIELDS})`,
    };
    if (pageToken) params.pageToken = pageToken;
    if (driveId) {
      params.driveId = driveId;
      params.corpora = "drive";
      params.includeItemsFromAllDrives = true;
    }
    const response = await drive.files.list(params);
    files.push(...(response.data.files || []));
    const nextPageToken = response.data.nextPageToken || undefined;
    if (!nextPageToken) return files;
    if (seenPageTokens.has(nextPageToken)) {
      throw new Error("Google Drive returned a repeated collision-search page token");
    }
    seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }
  throw new Error("Google Drive collision search exceeded 100 pages");
}

export function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function validateDestinationFolder(
  drive: DriveClientLike,
  folderId: string,
  driveId: string | undefined,
  account: string | null
): Promise<void> {
  if (!drive.files.get) throw new Error("Google Drive get operation is unavailable");
  const response = await drive.files.get({
    fileId: folderId,
    supportsAllDrives: true,
    fields: "id,name,mimeType,driveId,parents",
  });
  const folder = normalizeDriveFileForScope(response.data as DriveFile, account, driveId);
  if (folder.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error(`Drive item '${folderId}' is not a folder`);
  }
}

function normalizeDriveFileForScope(
  file: DriveFile,
  account: string | null,
  expectedDriveId?: string
): Record<string, unknown> {
  if (!expectedDriveId && file.driveId) {
    const fileId = requireProviderString(file.id, "Drive file id");
    throw new Error(`drive_id is required for Shared Drive item '${fileId}'`);
  }
  return normalizeDriveFile(file, account, expectedDriveId);
}

function normalizeDriveFile(
  file: DriveFile,
  account: string | null,
  expectedDriveId?: string
): Record<string, unknown> {
  const fileId = requireProviderString(file.id, "Drive file id");
  const name = requireProviderString(file.name, "Drive file name");
  const mimeType = requireProviderString(file.mimeType, "Drive file mimeType");
  if (expectedDriveId && !file.driveId) {
    throw new Error(`Drive file '${fileId}' does not identify Shared Drive '${expectedDriveId}'`);
  }
  if (expectedDriveId && file.driveId !== expectedDriveId) {
    throw new Error(`Drive file '${fileId}' belongs to a different Shared Drive`);
  }
  const driveId = file.driveId || expectedDriveId;
  return {
    provider: "google-drive",
    account,
    fileId,
    ...(driveId ? { driveId } : {}),
    ...(file.parents ? { parents: file.parents } : {}),
    name,
    mimeType,
    ...(file.webViewLink ? { webViewLink: file.webViewLink } : {}),
    ...(file.webContentLink ? { webContentLink: file.webContentLink } : {}),
    ...(file.resourceKey ? { resourceKey: file.resourceKey } : {}),
    ...(file.size ? { size: file.size } : {}),
    ...(file.createdTime ? { createdTime: file.createdTime } : {}),
    ...(file.modifiedTime ? { modifiedTime: file.modifiedTime } : {}),
    ...(file.sha256Checksum ? { sha256Checksum: file.sha256Checksum } : {}),
    ...(file.md5Checksum ? { md5Checksum: file.md5Checksum } : {}),
    ...(file.trashed == null ? {} : { trashed: file.trashed }),
    ...(file.capabilities ? { capabilities: file.capabilities } : {}),
  };
}

function requireProviderString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is missing from the Google Drive response`);
  }
  return value;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function requireRegularFile(value: unknown, field: string): string {
  const filePath = requireString(value, field);
  const fileStat = statSync(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`${field} must identify a regular file`);
  }
  return filePath;
}

async function hashFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function boundedInteger(
  value: unknown,
  field: string,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  if (value == null) return defaultValue;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${field} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}
