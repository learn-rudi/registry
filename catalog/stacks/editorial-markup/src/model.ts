import {
  LARGE_SOURCE_TEXT_CHARS,
  MAX_CHANGES_PER_ARTIFACT,
  MAX_SOURCE_TEXT_CHARS,
  type ChangePart,
  type ChangeStatus,
  type EditorialBlock,
  type EditorialDocument,
  type EditorialPart,
  type ExportCleanArgs,
  type ExportCleanResult,
  type ValidationIssue,
  type ValidationResult,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

const VALID_STATUSES = new Set<ChangeStatus>(["pending", "accepted", "rejected"]);

export class EditorialMarkupError extends Error {
  constructor(
    message: string,
    public code: string = "EDITORIAL_MARKUP_ERROR",
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "EditorialMarkupError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeHeadingLevel(value: unknown): 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3 ? value : 2;
}

function cloneMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return { ...value };
}

export function sourceTextToModel(
  sourceText: string,
  title?: string,
  options: { enforceInlineLimit?: boolean } = {},
): EditorialDocument {
  const enforceInlineLimit = options.enforceInlineLimit !== false;

  if (enforceInlineLimit && sourceText.length > MAX_SOURCE_TEXT_CHARS) {
    throw new EditorialMarkupError(
      `source_text exceeds the ${MAX_SOURCE_TEXT_CHARS} character limit; provide source_path/source_manifest or split the text into multiple artifacts.`,
      "SOURCE_TEXT_TOO_LARGE",
      { maxChars: MAX_SOURCE_TEXT_CHARS, actualChars: sourceText.length },
    );
  }

  const paragraphs = sourceText
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return {
    title,
    blocks: paragraphs.length > 0
      ? paragraphs.map((paragraph) => ({ type: "paragraph" as const, parts: [paragraph] }))
      : [{ type: "paragraph", parts: [""] }],
  };
}

export function normalizeEditorialModel(raw: unknown): EditorialDocument {
  const documentInput = Array.isArray(raw) ? { blocks: raw } : raw;
  if (!isRecord(documentInput)) {
    throw new EditorialMarkupError("edit_model must be an object with blocks or an array of blocks.", "INVALID_MODEL");
  }

  const rawBlocks = documentInput.blocks;
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
    throw new EditorialMarkupError("edit_model.blocks must be a non-empty array.", "INVALID_BLOCKS");
  }

  const blocks: EditorialBlock[] = rawBlocks.map((rawBlock, blockIndex) => {
    if (!isRecord(rawBlock)) {
      throw new EditorialMarkupError(`Block ${blockIndex} must be an object.`, "INVALID_BLOCK", { blockIndex });
    }

    const type = rawBlock.type === "heading" ? "heading" : rawBlock.type === "paragraph" ? "paragraph" : undefined;
    if (!type) {
      throw new EditorialMarkupError(
        `Block ${blockIndex} must have type "paragraph" or "heading".`,
        "INVALID_BLOCK_TYPE",
        { blockIndex },
      );
    }

    if (!Array.isArray(rawBlock.parts) || rawBlock.parts.length === 0) {
      throw new EditorialMarkupError(
        `Block ${blockIndex}.parts must be a non-empty array.`,
        "INVALID_PARTS",
        { blockIndex },
      );
    }

    const parts: EditorialPart[] = rawBlock.parts.map((rawPart, partIndex) => {
      if (typeof rawPart === "string") return rawPart;

      if (!isRecord(rawPart)) {
        throw new EditorialMarkupError(
          `Block ${blockIndex} part ${partIndex} must be a string or change object.`,
          "INVALID_PART",
          { blockIndex, partIndex },
        );
      }

      const id = optionalString(rawPart.id);
      const del = typeof rawPart.del === "string" ? rawPart.del : undefined;
      const ins = typeof rawPart.ins === "string" ? rawPart.ins : undefined;
      if (!id || del === undefined || ins === undefined) {
        throw new EditorialMarkupError(
          `Change at blocks[${blockIndex}].parts[${partIndex}] requires string id, del, and ins fields.`,
          "INVALID_CHANGE",
          { blockIndex, partIndex },
        );
      }

      if (del.trim().length === 0 && ins.trim().length === 0) {
        throw new EditorialMarkupError(
          `Change ${id} must include a deletion, insertion, or both.`,
          "EMPTY_CHANGE",
          { id, blockIndex, partIndex },
        );
      }

      const status = rawPart.status === undefined ? undefined : rawPart.status;
      if (status !== undefined && !VALID_STATUSES.has(status as ChangeStatus)) {
        throw new EditorialMarkupError(
          `Change ${id} has invalid status: ${String(status)}.`,
          "INVALID_STATUS",
          { id, status },
        );
      }

      const change: ChangePart = {
        id,
        del,
        ins,
      };

      if (status) change.status = status as ChangeStatus;
      if (typeof rawPart.noteTitle === "string" && rawPart.noteTitle.trim()) {
        change.noteTitle = rawPart.noteTitle;
      }
      if (typeof rawPart.note === "string" && rawPart.note.trim()) {
        change.note = rawPart.note;
      }
      return change;
    });

    if (type === "heading") {
      return { type, level: normalizeHeadingLevel(rawBlock.level), parts };
    }
    return { type, parts };
  });

  return {
    title: optionalString(documentInput.title),
    blocks,
    metadata: cloneMetadata(documentInput.metadata),
  };
}

export function getChangeStatus(part: ChangePart): ChangeStatus {
  return part.status ?? "pending";
}

export function isChangePart(part: EditorialPart): part is ChangePart {
  return typeof part !== "string";
}

function validationError(error: unknown): ValidationIssue {
  if (error instanceof EditorialMarkupError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  return {
    code: "UNEXPECTED_VALIDATION_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function validateEditorialModel(raw: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let blockCount = 0;
  let changeCount = 0;
  let noteCount = 0;
  let pendingCount = 0;

  let model: EditorialDocument;
  try {
    model = normalizeEditorialModel(raw);
  } catch (error) {
    return {
      valid: false,
      errors: [validationError(error)],
      warnings,
      blockCount,
      changeCount,
      noteCount,
      pendingCount,
      cleanExportReady: false,
    };
  }

  blockCount = model.blocks.length;
  const seenIds = new Set<string>();
  let sourceChars = 0;

  model.blocks.forEach((block, blockIndex) => {
    block.parts.forEach((part, partIndex) => {
      if (typeof part === "string") {
        sourceChars += part.length;
        return;
      }

      sourceChars += part.del.length + part.ins.length;
      changeCount += 1;
      if (part.note || part.noteTitle) noteCount += 1;
      if (getChangeStatus(part) === "pending") pendingCount += 1;

      if (seenIds.has(part.id)) {
        errors.push({
          code: "DUPLICATE_CHANGE_ID",
          message: `Duplicate change id: ${part.id}`,
          path: `blocks[${blockIndex}].parts[${partIndex}].id`,
        });
      }
      seenIds.add(part.id);
    });
  });

  if (sourceChars > LARGE_SOURCE_TEXT_CHARS) {
    warnings.push({
      code: "LARGE_ARTIFACT",
      message: `Model contains ${sourceChars} source characters; consider section navigation or multiple artifacts above ${LARGE_SOURCE_TEXT_CHARS}.`,
    });
  }

  if (changeCount > MAX_CHANGES_PER_ARTIFACT) {
    errors.push({
      code: "TOO_MANY_CHANGES",
      message: `Model contains ${changeCount} changes; split artifacts above ${MAX_CHANGES_PER_ARTIFACT} changes.`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    blockCount,
    changeCount,
    noteCount,
    pendingCount,
    cleanExportReady: pendingCount === 0,
  };
}

export function assertValidModel(raw: unknown): EditorialDocument {
  const validation = validateEditorialModel(raw);
  if (!validation.valid) {
    throw new EditorialMarkupError(
      validation.errors.map((error) => error.message).join("; "),
      "MODEL_VALIDATION_FAILED",
      { errors: validation.errors },
    );
  }
  return normalizeEditorialModel(raw);
}

function normalizeCleanParagraph(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .trim();
}

function renderCleanPart(part: EditorialPart, allowPending: boolean, pendingBehavior: "insertions" | "deletions"): string {
  if (typeof part === "string") return part;

  const status = getChangeStatus(part);
  if (status === "accepted") return part.ins;
  if (status === "rejected") return part.del;
  if (!allowPending) {
    throw new EditorialMarkupError(
      "Cannot export clean text while pending changes remain.",
      "PENDING_CHANGES",
    );
  }
  return pendingBehavior === "deletions" ? part.del : part.ins;
}

export function exportCleanText(args: ExportCleanArgs): ExportCleanResult {
  const model = assertValidModel(args.edit_model);
  const validation = validateEditorialModel(model);
  const allowPending = args.allow_pending === true;
  const pendingBehavior = args.pending_behavior ?? "insertions";

  if (validation.pendingCount > 0 && !allowPending) {
    throw new EditorialMarkupError(
      `Cannot export clean text with ${validation.pendingCount} pending changes.`,
      "PENDING_CHANGES",
      { pendingCount: validation.pendingCount },
    );
  }

  const text = model.blocks
    .map((block) => normalizeCleanParagraph(
      block.parts.map((part) => renderCleanPart(part, allowPending, pendingBehavior)).join(""),
    ))
    .filter(Boolean)
    .join("\n\n");

  return {
    text,
    pendingCount: validation.pendingCount,
    changeCount: validation.changeCount,
  };
}
