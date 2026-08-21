#!/usr/bin/env node
const assert = require("node:assert/strict");
const { mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { Readable } = require("node:stream");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function main() {
  await testSharedDriveListContract();
  await testDriveListValidationAndMyDriveDefaults();
  await testSharedDriveRequiresExplicitPerCallAccount();
  await testDriveListUsesSelectedAccountAndReturnsPagination();
  await testExactParentCollisionSearchEscapesAndPaginates();
  await testDriveUploadReturnsStableProviderReference();
  await testDriveUploadReusesOnlyOneChecksumMatch();
  await testSharedDriveUploadRejectsWrongParentBeforeCreating();
  await testImplicitSharedDriveIdsFailBeforeSideEffects();
  await testMyDriveCreateDefaultsRemainCompatible();
  await testDriveFolderReuseIsExplicitAndIdempotent();
  await testDriveFolderAmbiguityFailsClosed();
  await testDriveUpdateRejectsWrongDriveBeforeWriting();
  await testDriveUpdateRejectsMissingSharedDriveIdentityBeforeWriting();
  await testDriveUpdateRequiresExplicitSharedDriveScope();
  await testDriveMoveIsNoOpAtExactDestination();
  await testDriveDownloadReturnsHashOfWrittenBytes();
  await testDriveDownloadFailurePreservesExistingDestination();
  await testLegacyDestructiveToolsUseSelectedAccountButRejectSharedDrives();
  await testDriveHandlersAreDelegatedFromMcpServer();
  await testDriveUpdateHandlerUpdatesInPlace();
  await testDriveToolSchemas();
}

async function testSharedDriveListContract() {
  const { buildDriveListParams } = await import("./src/drive.ts");
  assert.deepEqual(
    buildDriveListParams({
      query: "'parent-123' in parents and trashed = false",
      max_results: 25,
      page_token: "next-page",
      drive_id: "shared-drive-123",
    }),
    {
      q: "'parent-123' in parents and trashed = false",
      pageSize: 25,
      pageToken: "next-page",
      driveId: "shared-drive-123",
      corpora: "drive",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,driveId,parents,size,createdTime,modifiedTime,webViewLink,webContentLink,resourceKey,sha256Checksum,md5Checksum,trashed,capabilities(canDownload,canEdit,canMoveItemWithinDrive))",
    }
  );
}

async function testDriveListValidationAndMyDriveDefaults() {
  const { buildDriveListParams } = await import("./src/drive.ts");
  assert.deepEqual(buildDriveListParams({}), {
    pageSize: 20,
    supportsAllDrives: true,
    fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,driveId,parents,size,createdTime,modifiedTime,webViewLink,webContentLink,resourceKey,sha256Checksum,md5Checksum,trashed,capabilities(canDownload,canEdit,canMoveItemWithinDrive))",
  });
  assert.throws(
    () => buildDriveListParams({ max_results: 0 }),
    /max_results must be an integer between 1 and 1000/
  );
  assert.throws(
    () => buildDriveListParams({ corpora: "drive" }),
    /drive_id is required when corpora is drive/
  );
  assert.throws(
    () => buildDriveListParams({ drive_id: "shared-drive-123", corpora: "user" }),
    /corpora must be drive when drive_id is provided/
  );
  assert.throws(
    () => buildDriveListParams({ corpora: "everything" }),
    /corpora must be one of user, drive, domain, allDrives/
  );
}

async function testSharedDriveRequiresExplicitPerCallAccount() {
  const { handleDriveTool } = await import("./src/drive.ts");
  let resolveCalls = 0;
  let driveCalls = 0;
  await assert.rejects(
    () => handleDriveTool(
      "drive_list",
      { drive_id: "shared-drive-123" },
      {
        resolveAccount() {
          resolveCalls += 1;
          return "active@example.com";
        },
        getDrive() {
          driveCalls += 1;
          throw new Error("provider access must not run without an explicit account");
        },
      }
    ),
    /account is required when drive_id is provided/
  );
  assert.equal(resolveCalls, 0);
  assert.equal(driveCalls, 0);
}

async function testDriveListUsesSelectedAccountAndReturnsPagination() {
  const { handleDriveTool } = await import("./src/drive.ts");
  const calls = [];
  const result = await handleDriveTool(
    "drive_list",
    {
      account: "work@example.com",
      drive_id: "shared-drive-123",
      max_results: 10,
    },
    {
      resolveAccount(args) {
        assert.equal(args.account, "work@example.com");
        return args.account;
      },
      getDrive(account) {
        calls.push({ type: "account", account });
        return {
          files: {
            async get(params) {
              assert.equal(params.fileId, "parent-123");
              return {
                data: {
                  id: "parent-123",
                  name: "Parent",
                  mimeType: "application/vnd.google-apps.folder",
                  driveId: "shared-drive-123",
                },
              };
            },
            async list(params) {
              calls.push({ type: "list", params });
              return {
                data: {
                  files: [{
                    id: "file-123",
                    name: "Proposal.pdf",
                    mimeType: "application/pdf",
                    driveId: "shared-drive-123",
                    parents: ["parent-123"],
                    size: "12",
                    sha256Checksum: "abc123",
                    webViewLink: "https://drive.example/file-123",
                  }],
                  nextPageToken: "next-page",
                  incompleteSearch: false,
                },
              };
            },
          },
        };
      },
    }
  );

  assert.deepEqual(calls[0], { type: "account", account: "work@example.com" });
  assert.deepEqual(calls[1], {
    type: "list",
    params: {
      pageSize: 10,
      driveId: "shared-drive-123",
      corpora: "drive",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,driveId,parents,size,createdTime,modifiedTime,webViewLink,webContentLink,resourceKey,sha256Checksum,md5Checksum,trashed,capabilities(canDownload,canEdit,canMoveItemWithinDrive))",
    },
  });
  assert.deepEqual(JSON.parse(result.content[0].text), [{
    id: "file-123",
    name: "Proposal.pdf",
    mimeType: "application/pdf",
    driveId: "shared-drive-123",
    parents: ["parent-123"],
    size: "12",
    sha256Checksum: "abc123",
    webViewLink: "https://drive.example/file-123",
  }]);
  assert.deepEqual(result.structuredContent, {
    provider: "google-drive",
    account: "work@example.com",
    driveId: "shared-drive-123",
    files: [{
      provider: "google-drive",
      account: "work@example.com",
      fileId: "file-123",
      driveId: "shared-drive-123",
      parents: ["parent-123"],
      name: "Proposal.pdf",
      mimeType: "application/pdf",
      webViewLink: "https://drive.example/file-123",
      size: "12",
      sha256Checksum: "abc123",
    }],
    nextPageToken: "next-page",
    incompleteSearch: false,
  });
}

async function testExactParentCollisionSearchEscapesAndPaginates() {
  const { findExactDriveFiles } = await import("./src/drive.ts");
  const calls = [];
  const pages = [
    { data: { files: [], nextPageToken: "page-2" } },
    {
      data: {
        files: [{
          id: "folder-123",
          name: "Client's \\ Archive",
          mimeType: "application/vnd.google-apps.folder",
          driveId: "drive-123",
          parents: ["parent's \\ root"],
        }],
      },
    },
  ];
  const drive = {
    files: {
      async list(params) {
        calls.push(params);
        return pages.shift();
      },
    },
  };

  const files = await findExactDriveFiles(drive, {
    parentId: "parent's \\ root",
    name: "Client's \\ Archive",
    driveId: "drive-123",
    mimeType: "application/vnd.google-apps.folder",
  });

  assert.equal(files.length, 1);
  assert.equal(files[0].id, "folder-123");
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].q,
    "'parent\\'s \\\\ root' in parents and name = 'Client\\'s \\\\ Archive' and trashed = false and mimeType = 'application/vnd.google-apps.folder'"
  );
  assert.equal(calls[0].pageToken, undefined);
  assert.equal(calls[1].pageToken, "page-2");
  assert.equal(calls[0].driveId, "drive-123");
  assert.equal(calls[0].corpora, "drive");
  assert.equal(calls[0].includeItemsFromAllDrives, true);
  assert.equal(calls[0].supportsAllDrives, true);
}

async function testDriveUploadReturnsStableProviderReference() {
  const { handleDriveTool } = await import("./src/drive.ts");
  const tempDir = mkdtempSync(path.join(tmpdir(), "google-workspace-drive-upload-"));
  const filePath = path.join(tempDir, "proposal.txt");
  const bytes = Buffer.from("Shared Drive proof\n", "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(filePath, bytes);
  const calls = [];

  try {
    const result = await handleDriveTool(
      "drive_upload",
      {
        account: "work@example.com",
        file_path: filePath,
        name: "Proposal.txt",
        folder_id: "parent-123",
        drive_id: "shared-drive-123",
        collision_policy: "fail",
      },
      {
        resolveAccount: (args) => args.account,
        getDrive: (account) => ({
          files: {
            async get(params) {
              calls.push({ type: "get", account, params });
              return {
                data: {
                  id: "parent-123",
                  name: "Parent",
                  mimeType: "application/vnd.google-apps.folder",
                  driveId: "shared-drive-123",
                },
              };
            },
            async list(params) {
              calls.push({ type: "list", account, params });
              return { data: { files: [] } };
            },
            async create(params) {
              const chunks = [];
              for await (const chunk of params.media.body) chunks.push(Buffer.from(chunk));
              calls.push({
                type: "create",
                account,
                params: { ...params, media: { ...params.media, body: Buffer.concat(chunks) } },
              });
              return {
                data: {
                  id: "file-123",
                  name: "Proposal.txt",
                  mimeType: "text/plain",
                  driveId: "shared-drive-123",
                  parents: ["parent-123"],
                  size: String(bytes.length),
                  sha256Checksum: sha256,
                  webViewLink: "https://drive.example/file-123",
                },
              };
            },
          },
        }),
      }
    );

    assert.equal(calls.length, 3);
    assert.equal(calls[0].type, "get");
    assert.equal(calls[0].params.fileId, "parent-123");
    assert.equal(calls[1].type, "list");
    assert.match(calls[1].params.q, /'parent-123' in parents/);
    assert.match(calls[1].params.q, /name = 'Proposal.txt'/);
    assert.equal(calls[2].type, "create");
    assert.equal(calls[2].params.supportsAllDrives, true);
    assert.deepEqual(calls[2].params.requestBody, {
      name: "Proposal.txt",
      parents: ["parent-123"],
    });
    assert.deepEqual(calls[2].params.media.body, bytes);
    assert.equal(result.content[0].text, "Uploaded: https://drive.example/file-123");
    assert.deepEqual(result.structuredContent, {
      provider: "google-drive",
      operation: "upload",
      account: "work@example.com",
      driveId: "shared-drive-123",
      created: true,
      reused: false,
      localSha256: sha256,
      file: {
        provider: "google-drive",
        account: "work@example.com",
        fileId: "file-123",
        driveId: "shared-drive-123",
        parents: ["parent-123"],
        name: "Proposal.txt",
        mimeType: "text/plain",
        webViewLink: "https://drive.example/file-123",
        size: String(bytes.length),
        sha256Checksum: sha256,
      },
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testDriveUploadReusesOnlyOneChecksumMatch() {
  const { handleDriveTool } = await import("./src/drive.ts");
  const tempDir = mkdtempSync(path.join(tmpdir(), "google-workspace-drive-reuse-"));
  const filePath = path.join(tempDir, "proof.txt");
  const bytes = Buffer.from("same bytes\n", "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(filePath, bytes);
  let createCalls = 0;
  const existing = {
    id: "file-existing",
    name: "proof.txt",
    mimeType: "text/plain",
    driveId: "shared-drive-123",
    parents: ["parent-123"],
    sha256Checksum: sha256,
    webViewLink: "https://drive.example/file-existing",
  };

  const makeDependencies = (files) => ({
    resolveAccount: (args) => args.account,
    getDrive: () => ({
      files: {
        async get(params) {
          assert.equal(params.fileId, "parent-123");
          return {
            data: {
              id: "parent-123",
              name: "Parent",
              mimeType: "application/vnd.google-apps.folder",
              driveId: "shared-drive-123",
            },
          };
        },
        async list() {
          return { data: { files } };
        },
        async create() {
          createCalls += 1;
          throw new Error("create must not run when collision handling resolves first");
        },
      },
    }),
  });

  try {
    const result = await handleDriveTool(
      "drive_upload",
      {
        account: "work@example.com",
        file_path: filePath,
        folder_id: "parent-123",
        drive_id: "shared-drive-123",
        collision_policy: "reuse_if_same",
      },
      makeDependencies([existing])
    );
    assert.equal(createCalls, 0);
    assert.equal(result.structuredContent.created, false);
    assert.equal(result.structuredContent.reused, true);
    assert.equal(result.structuredContent.file.fileId, "file-existing");

    await assert.rejects(
      () => handleDriveTool(
        "drive_upload",
        {
          account: "work@example.com",
          file_path: filePath,
          folder_id: "parent-123",
          drive_id: "shared-drive-123",
          collision_policy: "reuse_if_same",
        },
        makeDependencies([existing, { ...existing, id: "file-duplicate" }])
      ),
      /Upload is ambiguous: 2 files/
    );
    assert.equal(createCalls, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testSharedDriveUploadRejectsWrongParentBeforeCreating() {
  const { handleDriveTool } = await import("./src/drive.ts");
  const tempDir = mkdtempSync(path.join(tmpdir(), "google-workspace-drive-parent-"));
  const filePath = path.join(tempDir, "proof.txt");
  writeFileSync(filePath, "proof\n");
  let listCalls = 0;
  let createCalls = 0;

  try {
    await assert.rejects(
      () => handleDriveTool(
        "drive_upload",
        {
          account: "work@example.com",
          file_path: filePath,
          folder_id: "wrong-parent",
          drive_id: "expected-drive",
          collision_policy: "create_new",
        },
        {
          resolveAccount: (args) => args.account,
          getDrive: () => ({
            files: {
              async list() {
                listCalls += 1;
                return { data: { files: [] } };
              },
              async get(params) {
                assert.equal(params.fileId, "wrong-parent");
                return {
                  data: {
                    id: "wrong-parent",
                    name: "Wrong Parent",
                    mimeType: "application/vnd.google-apps.folder",
                    driveId: "different-drive",
                  },
                };
              },
              async create() {
                createCalls += 1;
                throw new Error("create must not run for a parent in another Drive");
              },
            },
          }),
        }
      ),
      /belongs to a different Shared Drive/
    );
    assert.equal(listCalls, 0);
    assert.equal(createCalls, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testImplicitSharedDriveIdsFailBeforeSideEffects() {
  const { handleDriveTool } = await import("./src/drive.ts");
  const tempDir = mkdtempSync(path.join(tmpdir(), "google-workspace-drive-implicit-"));
  const filePath = path.join(tempDir, "proof.txt");
  const outputPath = path.join(tempDir, "download.txt");
  writeFileSync(filePath, "proof\n");
  let sideEffectCalls = 0;

  const dependencies = {
    resolveAccount: (args) => args.account,
    getDrive: () => ({
      files: {
        async list() {
          sideEffectCalls += 1;
          throw new Error("list must not run after implicit Shared Drive detection");
        },
        async get(params) {
          return {
            data: {
              id: params.fileId,
              name: params.fileId === "shared-file" ? "proof.txt" : "Shared Parent",
              mimeType: params.fileId === "shared-file"
                ? "text/plain"
                : "application/vnd.google-apps.folder",
              driveId: "shared-drive-123",
            },
          };
        },
        async create() {
          sideEffectCalls += 1;
          throw new Error("create must not run after implicit Shared Drive detection");
        },
        async update() {
          sideEffectCalls += 1;
          throw new Error("update must not run after implicit Shared Drive detection");
        },
      },
    }),
  };

  try {
    const calls = [
      () => handleDriveTool("drive_upload", {
        account: "work@example.com",
        file_path: filePath,
        folder_id: "shared-parent",
      }, dependencies),
      () => handleDriveTool("drive_create_folder", {
        account: "work@example.com",
        name: "Finance",
        parent_id: "shared-parent",
      }, dependencies),
      () => handleDriveTool("drive_move_file", {
        account: "work@example.com",
        file_id: "shared-file",
        new_parent_id: "shared-parent",
      }, dependencies),
      () => handleDriveTool("drive_download", {
        account: "work@example.com",
        file_id: "shared-file",
        output_path: outputPath,
      }, dependencies),
    ];
    for (const call of calls) {
      await assert.rejects(call, /drive_id is required for Shared Drive item/);
    }
    assert.equal(sideEffectCalls, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testMyDriveCreateDefaultsRemainCompatible() {
  const { handleDriveTool } = await import("./src/drive.ts");
  const tempDir = mkdtempSync(path.join(tmpdir(), "google-workspace-my-drive-"));
  const filePath = path.join(tempDir, "proof.txt");
  writeFileSync(filePath, "proof\n");
  let listCalls = 0;
  let getCalls = 0;
  let createCalls = 0;
  const dependencies = {
    resolveAccount: (args) => args.account,
    getDrive: () => ({
      files: {
        async list() {
          listCalls += 1;
          throw new Error("legacy create_new defaults must not preflight name collisions");
        },
        async get() {
          getCalls += 1;
          throw new Error("My Drive root operations must not require Shared Drive preflight");
        },
        async create(params) {
          createCalls += 1;
          if (params.requestBody.mimeType === "application/vnd.google-apps.folder") {
            return {
              data: {
                id: "folder-my-drive",
                name: params.requestBody.name,
                mimeType: "application/vnd.google-apps.folder",
              },
            };
          }
          for await (const _chunk of params.media.body) {
            // Consume the real local stream.
          }
          return {
            data: {
              id: "file-my-drive",
              name: params.requestBody.name,
              mimeType: "text/plain",
              webViewLink: "https://drive.example/file-my-drive",
            },
          };
        },
      },
    }),
  };

  try {
    const upload = await handleDriveTool("drive_upload", {
      account: "work@example.com",
      file_path: filePath,
    }, dependencies);
    const folder = await handleDriveTool("drive_create_folder", {
      account: "work@example.com",
      name: "Finance",
    }, dependencies);

    assert.equal(listCalls, 0);
    assert.equal(getCalls, 0);
    assert.equal(createCalls, 2);
    assert.equal(upload.content[0].text, "Uploaded: https://drive.example/file-my-drive");
    assert.equal(upload.structuredContent.created, true);
    assert.equal(upload.structuredContent.file.fileId, "file-my-drive");
    assert.deepEqual(JSON.parse(folder.content[0].text), {
      id: "folder-my-drive",
      name: "Finance",
      mimeType: "application/vnd.google-apps.folder",
    });
    assert.equal(folder.structuredContent.created, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testDriveFolderReuseIsExplicitAndIdempotent() {
  const { handleDriveTool } = await import("./src/drive.ts");
  let createCalls = 0;
  const existingFolder = {
    id: "folder-123",
    name: "Finance",
    mimeType: "application/vnd.google-apps.folder",
    driveId: "shared-drive-123",
    parents: ["parent-123"],
    webViewLink: "https://drive.example/folder-123",
  };
  const result = await handleDriveTool(
    "drive_create_folder",
    {
      account: "work@example.com",
      name: "Finance",
      parent_id: "parent-123",
      drive_id: "shared-drive-123",
      collision_policy: "reuse",
    },
    {
      resolveAccount: (args) => args.account,
      getDrive: () => ({
        files: {
          async get(params) {
            assert.equal(params.fileId, "parent-123");
            return {
              data: {
                id: "parent-123",
                name: "Parent",
                mimeType: "application/vnd.google-apps.folder",
                driveId: "shared-drive-123",
              },
            };
          },
          async list() {
            return { data: { files: [existingFolder] } };
          },
          async create() {
            createCalls += 1;
            throw new Error("create must not run for an explicitly reused folder");
          },
        },
      }),
    }
  );

  assert.equal(createCalls, 0);
  assert.deepEqual(JSON.parse(result.content[0].text), existingFolder);
  assert.deepEqual(result.structuredContent, {
    provider: "google-drive",
    operation: "create_folder",
    account: "work@example.com",
    driveId: "shared-drive-123",
    created: false,
    reused: true,
    file: {
      provider: "google-drive",
      account: "work@example.com",
      fileId: "folder-123",
      driveId: "shared-drive-123",
      parents: ["parent-123"],
      name: "Finance",
      mimeType: "application/vnd.google-apps.folder",
      webViewLink: "https://drive.example/folder-123",
    },
  });
}

async function testDriveFolderAmbiguityFailsClosed() {
  const { handleDriveTool } = await import("./src/drive.ts");
  let createCalls = 0;
  const folder = {
    id: "folder-123",
    name: "Finance",
    mimeType: "application/vnd.google-apps.folder",
    driveId: "shared-drive-123",
    parents: ["parent-123"],
  };
  await assert.rejects(
    () => handleDriveTool(
      "drive_create_folder",
      {
        account: "work@example.com",
        name: "Finance",
        parent_id: "parent-123",
        drive_id: "shared-drive-123",
        collision_policy: "reuse",
      },
      {
        resolveAccount: (args) => args.account,
        getDrive: () => ({
          files: {
            async get() {
              return {
                data: {
                  id: "parent-123",
                  name: "Parent",
                  mimeType: "application/vnd.google-apps.folder",
                  driveId: "shared-drive-123",
                },
              };
            },
            async list() {
              return { data: { files: [folder, { ...folder, id: "folder-456" }] } };
            },
            async create() {
              createCalls += 1;
              throw new Error("create must not run for ambiguous folders");
            },
          },
        }),
      }
    ),
    /Folder creation is ambiguous: 2 folders/
  );
  assert.equal(createCalls, 0);
}

async function testDriveUpdateRejectsWrongDriveBeforeWriting() {
  const { handleDriveTool } = await import("./src/drive.ts");
  const tempDir = mkdtempSync(path.join(tmpdir(), "google-workspace-drive-update-"));
  const filePath = path.join(tempDir, "replacement.txt");
  writeFileSync(filePath, "replacement\n");
  let updateCalls = 0;

  try {
    await assert.rejects(
      () => handleDriveTool(
        "drive_update",
        {
          account: "work@example.com",
          file_id: "file-123",
          file_path: filePath,
          drive_id: "expected-drive",
        },
        {
          resolveAccount: (args) => args.account,
          getDrive: () => ({
            files: {
              async list() {
                throw new Error("list must not run");
              },
              async get(params) {
                assert.equal(params.supportsAllDrives, true);
                return {
                  data: {
                    id: "file-123",
                    name: "Existing.txt",
                    mimeType: "text/plain",
                    driveId: "different-drive",
                  },
                };
              },
              async update() {
                updateCalls += 1;
                throw new Error("update must not run for a Drive mismatch");
              },
            },
          }),
        }
      ),
      /belongs to a different Shared Drive/
    );
    assert.equal(updateCalls, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testDriveUpdateRejectsMissingSharedDriveIdentityBeforeWriting() {
  const { handleDriveTool } = await import("./src/drive.ts");
  const tempDir = mkdtempSync(path.join(tmpdir(), "google-workspace-drive-identity-"));
  const filePath = path.join(tempDir, "replacement.txt");
  writeFileSync(filePath, "replacement\n");
  let updateCalls = 0;

  try {
    await assert.rejects(
      () => handleDriveTool(
        "drive_update",
        {
          account: "work@example.com",
          file_id: "my-drive-file",
          file_path: filePath,
          drive_id: "expected-shared-drive",
        },
        {
          resolveAccount: (args) => args.account,
          getDrive: () => ({
            files: {
              async list() {
                throw new Error("list must not run");
              },
              async get() {
                return {
                  data: {
                    id: "my-drive-file",
                    name: "Existing.txt",
                    mimeType: "text/plain",
                  },
                };
              },
              async update() {
                updateCalls += 1;
                throw new Error("update must not run without exact Shared Drive identity");
              },
            },
          }),
        }
      ),
      /does not identify Shared Drive 'expected-shared-drive'/
    );
    assert.equal(updateCalls, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testDriveUpdateRequiresExplicitSharedDriveScope() {
  const { handleDriveTool } = await import("./src/drive.ts");
  const tempDir = mkdtempSync(path.join(tmpdir(), "google-workspace-drive-scope-"));
  const filePath = path.join(tempDir, "replacement.txt");
  writeFileSync(filePath, "replacement\n");
  let updateCalls = 0;

  try {
    await assert.rejects(
      () => handleDriveTool(
        "drive_update",
        {
          account: "work@example.com",
          file_id: "shared-file",
          file_path: filePath,
        },
        {
          resolveAccount: (args) => args.account,
          getDrive: () => ({
            files: {
              async list() {
                throw new Error("list must not run");
              },
              async get() {
                return {
                  data: {
                    id: "shared-file",
                    name: "Existing.txt",
                    mimeType: "text/plain",
                    driveId: "shared-drive-123",
                  },
                };
              },
              async update() {
                updateCalls += 1;
                throw new Error("update must not run without drive_id");
              },
            },
          }),
        }
      ),
      /drive_id is required for Shared Drive item 'shared-file'/
    );
    assert.equal(updateCalls, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testDriveMoveIsNoOpAtExactDestination() {
  const { handleDriveTool } = await import("./src/drive.ts");
  let updateCalls = 0;
  const existing = {
    id: "file-123",
    name: "Proposal.txt",
    mimeType: "text/plain",
    driveId: "shared-drive-123",
    parents: ["parent-123"],
  };
  const result = await handleDriveTool(
    "drive_move_file",
    {
      account: "work@example.com",
      file_id: "file-123",
      new_parent_id: "parent-123",
      drive_id: "shared-drive-123",
    },
    {
      resolveAccount: (args) => args.account,
      getDrive: () => ({
        files: {
          async list() {
            throw new Error("list must not run");
          },
          async get(params) {
            assert.equal(params.supportsAllDrives, true);
            if (params.fileId === "parent-123") {
              return {
                data: {
                  id: "parent-123",
                  name: "Parent",
                  mimeType: "application/vnd.google-apps.folder",
                  driveId: "shared-drive-123",
                },
              };
            }
            return { data: existing };
          },
          async update() {
            updateCalls += 1;
            throw new Error("update must not run when the destination is already exact");
          },
        },
      }),
    }
  );

  assert.equal(updateCalls, 0);
  assert.deepEqual(JSON.parse(result.content[0].text), existing);
  assert.equal(result.structuredContent.operation, "move");
  assert.equal(result.structuredContent.moved, false);
  assert.equal(result.structuredContent.noOp, true);
  assert.equal(result.structuredContent.file.fileId, "file-123");
}

async function testDriveDownloadReturnsHashOfWrittenBytes() {
  const { handleDriveTool } = await import("./src/drive.ts");
  const tempDir = mkdtempSync(path.join(tmpdir(), "google-workspace-drive-download-"));
  const outputPath = path.join(tempDir, "nested", "download.txt");
  const bytes = Buffer.from("downloaded bytes\n", "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  try {
    const result = await handleDriveTool(
      "drive_download",
      {
        account: "work@example.com",
        file_id: "file-123",
        output_path: outputPath,
        drive_id: "shared-drive-123",
      },
      {
        resolveAccount: (args) => args.account,
        getDrive: () => ({
          files: {
            async list() {
              throw new Error("list must not run");
            },
            async get(params, options) {
              assert.equal(params.supportsAllDrives, true);
              if (params.alt === "media") {
                assert.equal(options.responseType, "stream");
                return { data: Readable.from(bytes) };
              }
              return {
                data: {
                  id: "file-123",
                  name: "download.txt",
                  mimeType: "text/plain",
                  driveId: "shared-drive-123",
                  parents: ["parent-123"],
                  size: String(bytes.length),
                  sha256Checksum: sha256,
                  capabilities: { canDownload: true },
                },
              };
            },
          },
        }),
      }
    );

    assert.deepEqual(readFileSync(outputPath), bytes);
    assert.deepEqual(JSON.parse(result.content[0].text), {
      path: outputPath,
      bytes: bytes.length,
      sha256,
    });
    assert.equal(result.structuredContent.operation, "download");
    assert.equal(result.structuredContent.sha256, sha256);
    assert.equal(result.structuredContent.file.fileId, "file-123");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testDriveDownloadFailurePreservesExistingDestination() {
  const { handleDriveTool } = await import("./src/drive.ts");
  const tempDir = mkdtempSync(path.join(tmpdir(), "google-workspace-drive-download-failure-"));
  const outputPath = path.join(tempDir, "download.txt");
  writeFileSync(outputPath, "original bytes\n");

  try {
    await assert.rejects(
      () => handleDriveTool(
        "drive_download",
        {
          account: "work@example.com",
          file_id: "file-123",
          output_path: outputPath,
        },
        {
          resolveAccount: (args) => args.account,
          getDrive: () => ({
            files: {
              async list() {
                throw new Error("list must not run");
              },
              async get(params) {
                if (params.alt === "media") {
                  return {
                    data: Readable.from((async function* () {
                      yield Buffer.from("partial");
                      throw new Error("provider stream failed");
                    })()),
                  };
                }
                return {
                  data: {
                    id: "file-123",
                    name: "download.txt",
                    mimeType: "text/plain",
                    capabilities: { canDownload: true },
                  },
                };
              },
            },
          }),
        }
      ),
      /provider stream failed/
    );
    assert.equal(readFileSync(outputPath, "utf8"), "original bytes\n");
    assert.deepEqual(readdirSync(tempDir), ["download.txt"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testLegacyDestructiveToolsUseSelectedAccountButRejectSharedDrives() {
  const { handleDriveTool } = await import("./src/drive.ts");
  const accounts = [];
  const calls = [];
  const metadataGets = [];
  const implicitSharedIds = new Set(["shared-public", "shared-delete"]);
  const dependencies = {
    resolveAccount: (args) => args.account,
    getDrive: (account) => {
      accounts.push(account);
      return {
        files: {
          async list() {
            throw new Error("list must not run");
          },
          async get(params) {
            metadataGets.push(params);
            return {
              data: {
                id: params.fileId,
                name: `${params.fileId}.txt`,
                mimeType: "text/plain",
                ...(implicitSharedIds.has(params.fileId) ? { driveId: "shared-drive-123" } : {}),
              },
            };
          },
          async delete(params) {
            calls.push({ type: "delete", params });
            return { data: {} };
          },
        },
        permissions: {
          async create(params) {
            calls.push({ type: "permission", params });
            return { data: {} };
          },
        },
      };
    },
  };

  const publicResult = await handleDriveTool(
    "drive_make_public",
    { account: "work@example.com", file_id: "file-123" },
    dependencies
  );
  const deleteResult = await handleDriveTool(
    "drive_delete",
    { account: "work@example.com", file_id: "file-456" },
    dependencies
  );

  assert.deepEqual(accounts, ["work@example.com", "work@example.com"]);
  assert.deepEqual(
    metadataGets.map((params) => params.fileId),
    ["file-123", "file-456"],
    "legacy destructive tools must preflight My Drive scope before side effects"
  );
  assert.deepEqual(calls, [
    {
      type: "permission",
      params: {
        fileId: "file-123",
        requestBody: { role: "reader", type: "anyone" },
      },
    },
    { type: "delete", params: { fileId: "file-456" } },
  ]);
  assert.match(publicResult.content[0].text, /https:\/\/drive\.google\.com\/uc\?id=file-123/);
  assert.equal(deleteResult.content[0].text, "Deleted file: file-456");

  await assert.rejects(
    () => handleDriveTool(
      "drive_delete",
      { account: "work@example.com", file_id: "file-456", drive_id: "shared-drive-123" },
      dependencies
    ),
    /drive_delete does not support Shared Drive operations/
  );

  await assert.rejects(
    () => handleDriveTool(
      "drive_make_public",
      { account: "work@example.com", file_id: "shared-public" },
      dependencies
    ),
    /drive_make_public does not support Shared Drive operations/
  );
  await assert.rejects(
    () => handleDriveTool(
      "drive_delete",
      { account: "work@example.com", file_id: "shared-delete" },
      dependencies
    ),
    /drive_delete does not support Shared Drive operations/
  );
  assert.equal(
    calls.length,
    2,
    "implicit Shared Drive IDs must be rejected before permission or delete side effects"
  );
}

async function testDriveHandlersAreDelegatedFromMcpServer() {
  const source = readFileSync("./src/index.ts", "utf8");
  assert.match(
    source,
    /import \{ handleDriveTool \} from "\.\/drive\.js";/,
    "the MCP server must import the Drive handler"
  );
  assert.match(
    source,
    /import \{ DRIVE_TOOL_DEFINITIONS \} from "\.\/driveSchemas\.js";/,
    "the MCP server must import the Drive schemas"
  );
  assert.match(
    source,
    /await handleDriveTool\(\s*name,\s*args as Record<string, unknown> \| undefined,\s*DRIVE_DEPENDENCIES\s*\)/,
    "the MCP call boundary must delegate Drive tools to the tested handler"
  );
  const directUploadStart = source.indexOf("export async function driveUpload");
  assert(directUploadStart >= 0, "the legacy direct driveUpload export must remain available");
  const directUploadBody = source.slice(
    directUploadStart,
    source.indexOf("export async function", directUploadStart + 25)
  );
  assert.match(
    directUploadBody,
    /handleDriveTool\("drive_upload"/,
    "the legacy direct driveUpload export must delegate to the canonical Drive handler"
  );
}

async function testDriveUpdateHandlerUpdatesInPlace() {
  const { handleDriveTool } = await import("./src/drive.ts");
  const tempDir = mkdtempSync(path.join(tmpdir(), "google-workspace-drive-update-green-"));
  const filePath = path.join(tempDir, "replacement.txt");
  writeFileSync(filePath, "replacement\n");
  let createCalls = 0;
  let updateCalls = 0;

  try {
    const result = await handleDriveTool(
      "drive_update",
      {
        account: "work@example.com",
        file_id: "file-123",
        file_path: filePath,
        name: "Renamed.txt",
      },
      {
        resolveAccount: (args) => args.account,
        getDrive: () => ({
          files: {
            async list() {
              throw new Error("list must not run");
            },
            async get(params) {
              assert.equal(params.fileId, "file-123");
              return {
                data: {
                  id: "file-123",
                  name: "Existing.txt",
                  mimeType: "text/plain",
                },
              };
            },
            async create() {
              createCalls += 1;
              throw new Error("create must never run for drive_update");
            },
            async update(params) {
              updateCalls += 1;
              assert.equal(params.fileId, "file-123");
              assert.equal(params.supportsAllDrives, true);
              assert.deepEqual(params.requestBody, { name: "Renamed.txt" });
              for await (const _chunk of params.media.body) {
                // Consume the stream to exercise the real file boundary.
              }
              return {
                data: {
                  id: "file-123",
                  name: "Renamed.txt",
                  mimeType: "text/plain",
                  modifiedTime: "2026-08-21T12:00:00.000Z",
                  webViewLink: "https://drive.example/file-123",
                },
              };
            },
          },
        }),
      }
    );

    assert.equal(updateCalls, 1);
    assert.equal(createCalls, 0);
    assert.equal(result.structuredContent.operation, "update");
    assert.equal(result.structuredContent.file.fileId, "file-123");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testDriveToolSchemas() {
  const stateDir = mkdtempSync(path.join(tmpdir(), "google-workspace-drive-tools-"));
  const client = new Client(
    { name: "google-workspace-drive-test", version: "0.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: process.cwd(),
    env: { RUDI_STACK_STATE_DIR: stateDir },
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    assert(byName.drive_update, "drive_update tool must be exposed");
    const props = byName.drive_update.inputSchema.properties;
    assert(props.file_id, "drive_update must accept file_id");
    assert(props.file_path, "drive_update must accept file_path");
    assert(props.name, "drive_update must accept an optional new name");
    assert.deepEqual(
      byName.drive_update.inputSchema.required.sort(),
      ["file_id", "file_path"],
      "drive_update must require file_id and file_path"
    );

    const driveToolNames = [
      "drive_list",
      "drive_upload",
      "drive_update",
      "drive_create_folder",
      "drive_move_file",
      "drive_download",
      "drive_make_public",
      "drive_delete",
    ];
    for (const name of driveToolNames) {
      assert(byName[name], `${name} tool must be exposed`);
      assert(byName[name].inputSchema.properties.account, `${name} must accept account`);
    }

    const listProps = byName.drive_list.inputSchema.properties;
    assert(listProps.drive_id, "drive_list must accept drive_id");
    assert(listProps.corpora, "drive_list must accept corpora");
    assert(listProps.page_token, "drive_list must accept page_token");
    assert.equal(listProps.max_results.type, "integer");
    assert.equal(listProps.max_results.minimum, 1);
    assert.equal(listProps.max_results.maximum, 1000);

    const uploadProps = byName.drive_upload.inputSchema.properties;
    assert(uploadProps.drive_id, "drive_upload must accept drive_id");
    assert(uploadProps.collision_policy, "drive_upload must accept collision_policy");
    assert.deepEqual(uploadProps.collision_policy.enum, ["create_new", "fail", "reuse_if_same"]);

    const folderProps = byName.drive_create_folder.inputSchema.properties;
    assert(folderProps.drive_id, "drive_create_folder must accept drive_id");
    assert.deepEqual(folderProps.collision_policy.enum, ["create_new", "fail", "reuse"]);

    for (const name of ["drive_update", "drive_move_file", "drive_download"]) {
      assert(byName[name].inputSchema.properties.drive_id, `${name} must accept drive_id`);
    }
    assert.equal(
      byName.drive_delete.description,
      "Permanently delete a file from My Drive. Shared Drive deletion is not supported by this tool.",
      "drive_delete must accurately describe its destructive behavior"
    );
    assert.deepEqual(byName.drive_list.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    assert.equal(byName.drive_upload.annotations.idempotentHint, false);
    assert.equal(byName.drive_update.annotations.destructiveHint, true);
    assert.equal(byName.drive_make_public.annotations.destructiveHint, true);
    assert.equal(byName.drive_delete.annotations.destructiveHint, true);

    const invalidAccountResult = await client.callTool({
      name: "drive_list",
      arguments: {
        account: "../work@example.com",
        drive_id: "shared-drive-123",
      },
    });
    assert.equal(invalidAccountResult.isError, true);
    assert.match(invalidAccountResult.content[0].text, /Google account must be a valid email address/);
  } finally {
    await client.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
