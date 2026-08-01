export const MAX_SOURCE_TEXT_CHARS = 200_000;
export const LARGE_SOURCE_TEXT_CHARS = 100_000;
export const MAX_CHANGES_PER_ARTIFACT = 250;

export type ChangeStatus = "pending" | "accepted" | "rejected";
export type ReviewMode = "interactive" | "static";

export interface ChangePart {
  id: string;
  del: string;
  ins: string;
  status?: ChangeStatus;
  noteTitle?: string;
  note?: string;
}

export type EditorialPart = string | ChangePart;

export interface ParagraphBlock {
  type: "paragraph";
  parts: EditorialPart[];
}

export interface HeadingBlock {
  type: "heading";
  level?: 1 | 2 | 3;
  parts: EditorialPart[];
}

export type EditorialBlock = ParagraphBlock | HeadingBlock;

export interface EditorialDocument {
  title?: string;
  blocks: EditorialBlock[];
  metadata?: Record<string, unknown>;
}

export interface SourceManifestSection {
  title?: string;
  source_text?: string;
  source_path?: string;
}

export interface SourceManifest {
  title?: string;
  sections: SourceManifestSection[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  blockCount: number;
  changeCount: number;
  noteCount: number;
  pendingCount: number;
  cleanExportReady: boolean;
}

export interface BuildEditorialMarkupArgs {
  edit_model?: unknown;
  source_text?: string;
  source_path?: string;
  source_manifest?: unknown;
  title?: string;
  output_dir?: string;
  output_path?: string;
  filename?: string;
  mode?: ReviewMode;
}

export interface BuildEditorialMarkupResult {
  htmlPath: string;
  mode: ReviewMode;
  title: string;
  validation: ValidationResult;
  blockCount: number;
  changeCount: number;
  noteCount: number;
}

export interface ExportCleanArgs {
  edit_model: unknown;
  allow_pending?: boolean;
  pending_behavior?: "insertions" | "deletions";
}

export interface ExportCleanResult {
  text: string;
  pendingCount: number;
  changeCount: number;
}

export interface QaArgs {
  html_path: string;
  output_dir?: string;
}

export interface QaCheck {
  name: string;
  passed: boolean;
  details?: string;
}

export interface QaIssue {
  code: string;
  message: string;
  viewport?: string;
}

export interface QaResult {
  success: boolean;
  htmlPath: string;
  screenshots: string[];
  checks: QaCheck[];
  errors: QaIssue[];
  warnings: QaIssue[];
}
