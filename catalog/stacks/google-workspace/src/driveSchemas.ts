const ACCOUNT_INPUT = {
  type: "string",
  description: "Optional configured Google account email. Overrides the currently active account for this call.",
};

const DRIVE_ID_INPUT = {
  type: "string",
  description: "Optional Google Shared Drive ID. Requires an explicit account and validates one Shared Drive for this call.",
};

const READ_ONLY_TOOL = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const MUTATING_TOOL = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const DESTRUCTIVE_TOOL = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export const DRIVE_TOOL_DEFINITIONS = [
  {
    name: "drive_list",
    description: "List files in My Drive or one explicitly selected Google Shared Drive",
    annotations: READ_ONLY_TOOL,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional Google Drive search query" },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 1000,
          description: "Maximum files in this page (default 20)",
        },
        page_token: { type: "string", description: "Continuation token from a previous page" },
        drive_id: DRIVE_ID_INPUT,
        corpora: {
          type: "string",
          enum: ["user", "drive", "domain", "allDrives"],
          description: "Search corpus. drive requires drive_id; drive_id always selects drive.",
        },
        account: ACCOUNT_INPUT,
      },
    },
  },
  {
    name: "drive_upload",
    description: "Upload a local file to My Drive or one explicitly selected Google Shared Drive",
    annotations: MUTATING_TOOL,
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Local file path" },
        name: { type: "string", description: "Name in Drive" },
        folder_id: { type: "string", description: "Destination folder ID" },
        drive_id: DRIVE_ID_INPUT,
        collision_policy: {
          type: "string",
          enum: ["create_new", "fail", "reuse_if_same"],
          description: "Exact-parent/name collision behavior. Defaults to create_new in My Drive and fail in a Shared Drive.",
        },
        account: ACCOUNT_INPUT,
      },
      required: ["file_path"],
    },
  },
  {
    name: "drive_update",
    description: "Replace a Drive file's content in place while preserving its file ID and shared links",
    annotations: DESTRUCTIVE_TOOL,
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "Existing Drive file ID" },
        file_path: { type: "string", description: "Local replacement file path" },
        name: { type: "string", description: "Optional replacement file name" },
        drive_id: DRIVE_ID_INPUT,
        account: ACCOUNT_INPUT,
      },
      required: ["file_id", "file_path"],
    },
  },
  {
    name: "drive_create_folder",
    description: "Create a folder in My Drive or one explicitly selected Google Shared Drive",
    annotations: MUTATING_TOOL,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Folder name" },
        parent_id: { type: "string", description: "Parent folder ID (optional, defaults to root or drive_id)" },
        drive_id: DRIVE_ID_INPUT,
        collision_policy: {
          type: "string",
          enum: ["create_new", "fail", "reuse"],
          description: "Exact-parent/name collision behavior. Defaults to create_new in My Drive and fail in a Shared Drive.",
        },
        account: ACCOUNT_INPUT,
      },
      required: ["name"],
    },
  },
  {
    name: "drive_move_file",
    description: "Move a file to an exact folder in My Drive or one explicitly selected Google Shared Drive",
    annotations: { ...DESTRUCTIVE_TOOL, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "File ID to move" },
        new_parent_id: { type: "string", description: "Destination folder ID" },
        drive_id: DRIVE_ID_INPUT,
        account: ACCOUNT_INPUT,
      },
      required: ["file_id", "new_parent_id"],
    },
  },
  {
    name: "drive_download",
    description: "Download a stored Drive file's bytes to a local path and calculate SHA-256",
    annotations: { ...DESTRUCTIVE_TOOL, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "Stored Drive file ID" },
        output_path: { type: "string", description: "Local path to write to" },
        drive_id: DRIVE_ID_INPUT,
        account: ACCOUNT_INPUT,
      },
      required: ["file_id", "output_path"],
    },
  },
  {
    name: "drive_make_public",
    description: "Make a My Drive file publicly viewable. Shared Drive permission changes are not supported by this tool.",
    annotations: DESTRUCTIVE_TOOL,
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "The My Drive file ID to make public" },
        account: ACCOUNT_INPUT,
      },
      required: ["file_id"],
    },
  },
  {
    name: "drive_delete",
    description: "Permanently delete a file from My Drive. Shared Drive deletion is not supported by this tool.",
    annotations: DESTRUCTIVE_TOOL,
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "The My Drive file ID to permanently delete" },
        account: ACCOUNT_INPUT,
      },
      required: ["file_id"],
    },
  },
];
