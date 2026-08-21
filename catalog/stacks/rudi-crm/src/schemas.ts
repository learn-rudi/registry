import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nonEmptyString = z.string().trim().min(1);
const optionalText = z.string().trim().optional();
const optionalUuid = z.string().uuid().optional();
const normalizedEmail = z.string().trim().toLowerCase().email().max(320);
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

export const ContactAddressCategory = z.enum([
  "person",
  "shared_inbox",
  "marketing",
  "notification",
  "automated",
  "unknown",
]);

export const MAX_RESULT_LIMIT = 100;
export const DEFAULT_RESULT_LIMIT = 25;

const resultLimit = z.number().int().min(1).max(MAX_RESULT_LIMIT).default(DEFAULT_RESULT_LIMIT);
const resultOffset = z.number().int().min(0).default(0);

export const RudiCrmObservation = z.object({
  source: z.enum(["gmail", "calendar", "otter", "slack", "manual"]),
  source_id: nonEmptyString,
  source_thread_id: optionalText,
  observed_at: isoDateTime,
  address_role: z.enum(["from", "to", "cc", "bcc", "attendee", "host", "sender", "recipient"]),
  address: normalizedEmail,
  display_name: z.string().trim().max(200).optional(),
  idempotency_key: optionalText,
  raw: z.record(z.unknown()).optional(),
});

export const RecordDiscoveryObservationsInput = z.object({
  observations: z.array(RudiCrmObservation).min(1).max(500),
});

const DiscoverySource = z.enum(["gmail", "calendar"]);
const DiscoveryObservation = z.object({
  resource_key: sha256Hex,
  observed_at: isoDateTime,
  address_role: z.enum(["from", "to", "cc", "organizer", "attendee"]),
  address: normalizedEmail,
  display_name: z.string().trim().min(1).max(200).optional(),
  recurrence_key: sha256Hex.optional(),
}).strict();

const DiscoveryRunScope = z.object({
  schema_version: z.literal("1"),
  source: DiscoverySource,
  account_scope: normalizedEmail,
  calendar_scope: z.string().trim().min(1).max(512).optional(),
  run_key: sha256Hex,
  cutoff: isoDateTime,
}).strict();

function validateDiscoveryScope(
  value: {
    source: "gmail" | "calendar";
    calendar_scope?: string;
  },
  ctx: z.RefinementCtx
): void {
  if (value.source === "gmail" && value.calendar_scope !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "calendar_scope is forbidden for Gmail discovery",
      path: ["calendar_scope"],
    });
  }
  if (value.source === "calendar" && value.calendar_scope === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "calendar_scope is required for Calendar discovery",
      path: ["calendar_scope"],
    });
  }
}

export const RecordDiscoveryPageInput = DiscoveryRunScope.extend({
  page_number: z.number().int().min(1).max(500),
  page_key: sha256Hex,
  observations: z.array(DiscoveryObservation).max(500),
}).strict().superRefine((value, ctx) => {
  validateDiscoveryScope(value, ctx);
  const cutoff = Date.parse(value.cutoff);
  let previousKey = "";
  value.observations.forEach((observation, index) => {
    const validRoles = value.source === "gmail"
      ? ["from", "to", "cc"]
      : ["organizer", "attendee"];
    if (!validRoles.includes(observation.address_role)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `address_role is invalid for ${value.source}`,
        path: ["observations", index, "address_role"],
      });
    }
    if (Date.parse(observation.observed_at) > cutoff) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "observed_at must not exceed cutoff",
        path: ["observations", index, "observed_at"],
      });
    }
    const orderingKey = [
      observation.observed_at,
      observation.resource_key,
      observation.address_role,
      observation.address,
    ].join("\0");
    if (index > 0 && orderingKey <= previousKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "observations must be unique and deterministically ordered",
        path: ["observations", index],
      });
    }
    previousKey = orderingKey;
  });
});

export const FinalizeDiscoveryRunInput = DiscoveryRunScope.extend({
  expected_pages: z.number().int().min(1).max(500),
  expected_records: z.number().int().min(0).max(250_000),
}).strict().superRefine(validateDiscoveryScope);

export const LogIngestBatchInput = z.object({
  source: nonEmptyString,
  window_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  window_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  domain_filter: optionalText,
  messages_seen: z.number().int().min(0).default(0),
  messages_inserted: z.number().int().min(0).default(0),
  messages_updated: z.number().int().min(0).default(0),
  skipped_noise: z.number().int().min(0).default(0),
  triage_count: z.number().int().min(0).default(0),
  validator_result: optionalText,
  notes: optionalText,
});

export const UpsertInteractionInput = z.object({
  source: nonEmptyString,
  source_id: nonEmptyString,
  channel: nonEmptyString,
  direction: z.enum(["inbound", "outbound"]),
  occurred_at: isoDateTime,
  subject: z.string().trim(),
  summary: z.string().trim(),
  source_url: optionalText,
  engagement_id: optionalUuid,
  thread_id: optionalUuid,
  created_by_actor_id: optionalUuid,
  related_interaction_id: optionalUuid,
});

export const RunValidatorsInput = z.object({
  include_rows: z.boolean().default(false),
});

export const LimitInput = z.object({
  limit: resultLimit,
});

export const PagedInput = z.object({
  limit: resultLimit,
  offset: resultOffset,
});

export const ListPeopleInput = PagedInput.extend({
  organization_name: optionalText,
  organization_category: optionalText,
  engagement_id: optionalUuid,
  engagement_name: optionalText,
  role: optionalText,
  search: optionalText,
  has_email: z.boolean().optional(),
});

export const ListContactCandidatesInput = PagedInput.extend({
  min_observations: z.number().int().min(1).max(10_000).default(2),
  since: isoDateTime.optional(),
  include_existing: z.boolean().default(false),
  address_category: ContactAddressCategory.optional(),
});

export const ClassifyContactAddressInput = z.object({
  email: normalizedEmail,
  category: ContactAddressCategory,
  source: z.enum(["manual", "agent", "rule", "import"]).default("manual"),
  reason: z.string().trim().max(1_000).optional(),
  created_by_actor_id: optionalUuid,
});

export const PromoteContactInput = z.object({
  email: normalizedEmail,
  full_name: nonEmptyString.max(200),
  existing_person_id: optionalUuid,
  organization_id: optionalUuid,
  title: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(100).optional(),
  role: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(4_000).optional(),
  email_label: z.enum(["work", "personal", "alias", "former", "unknown"]).default("work"),
  source: z.enum(["gmail", "calendar", "manual", "import", "slack", "otter"]).default("gmail"),
  created_by_actor_id: optionalUuid,
});

export const ListOrganizationsInput = PagedInput.extend({
  category: optionalText,
  search: optionalText,
  has_engagements: z.boolean().optional(),
});

export const ListEngagementsInput = PagedInput.extend({
  organization_name: optionalText,
  organization_category: optionalText,
  pipeline_stage: optionalText,
  status: optionalText,
  priority: optionalText,
  search: optionalText,
  stale_days: z.number().int().min(1).max(3650).optional(),
});

export const ActivityFeedInput = PagedInput.extend({
  engagement_id: optionalUuid,
  organization_name: optionalText,
  organization_category: optionalText,
  engagement_name: optionalText,
  source: optionalText,
  channel: optionalText,
  direction: z.enum(["inbound", "outbound"]).optional(),
  since: isoDateTime.optional(),
  until: isoDateTime.optional(),
});

export const AttentionBriefInput = z.object({
  as_of: isoDate.optional(),
  stale_days: z.number().int().min(1).max(3650).default(14),
  limit: resultLimit,
});

const financeAmount = z
  .union([z.number(), z.string().trim()])
  .transform((value, ctx) => {
    const numeric = typeof value === "string" ? Number(value) : value;
    if (!Number.isFinite(numeric)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "amount must be numeric" });
      return z.NEVER;
    }
    if (numeric < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount must be a non-negative magnitude",
      });
      return z.NEVER;
    }
    return numeric;
  });

export const RecordFinanceEventInput = z
  .object({
    engagement_id: z.string().uuid(),
    event_type: z.enum([
      "budget",
      "estimate",
      "proposal",
      "contract",
      "invoice",
      "payment",
      "refund",
      "expense",
      "adjustment",
    ]),
    amount: financeAmount,
    direction: z.enum(["positive", "negative"]).default("positive"),
    currency: z.string().trim().regex(/^[A-Z]{3}$/).default("USD"),
    occurred_at: isoDateTime,
    source: z.enum([
      "manual",
      "gmail",
      "calendar",
      "otter",
      "slack",
      "contract",
      "invoice",
      "payment_processor",
      "import",
    ]),
    source_id: optionalText,
    source_url: optionalText,
    source_interaction_id: optionalUuid,
    source_deliverable_id: optionalUuid,
    created_by_actor_id: optionalUuid,
    notes: optionalText,
  })
  .refine(
    (value) =>
      value.source === "manual" ||
      Boolean(value.source_id && value.source_id.length > 0),
    {
      message: "source_id is required for non-manual finance sources",
      path: ["source_id"],
    }
  );

export const EngagementContextInput = z.object({
  engagement_id: z.string().uuid().optional(),
  organization_name: optionalText,
  engagement_name: optionalText,
  recent_interactions_limit: z.number().int().min(1).max(MAX_RESULT_LIMIT).default(10),
}).refine(
  (value) => Boolean(value.engagement_id || value.organization_name || value.engagement_name),
  "Provide one of engagement_id, organization_name, or engagement_name"
);

export const LatestCorrespondenceInput = z.object({
  engagement_id: z.string().uuid().optional(),
  organization_name: optionalText,
  source: optionalText,
  limit: z.number().int().min(1).max(MAX_RESULT_LIMIT).default(10),
}).refine(
  (value) => Boolean(value.engagement_id || value.organization_name),
  "Provide engagement_id or organization_name"
);

export type RecordDiscoveryObservationsArgs = z.infer<typeof RecordDiscoveryObservationsInput>;
export type LogIngestBatchArgs = z.infer<typeof LogIngestBatchInput>;
export type UpsertInteractionArgs = z.infer<typeof UpsertInteractionInput>;
export type RunValidatorsArgs = z.infer<typeof RunValidatorsInput>;
export type LimitArgs = z.infer<typeof LimitInput>;
export type PagedArgs = z.infer<typeof PagedInput>;
export type ListPeopleArgs = z.infer<typeof ListPeopleInput>;
export type ListContactCandidatesArgs = z.infer<typeof ListContactCandidatesInput>;
export type ClassifyContactAddressArgs = z.infer<typeof ClassifyContactAddressInput>;
export type PromoteContactArgs = z.infer<typeof PromoteContactInput>;
export type ListOrganizationsArgs = z.infer<typeof ListOrganizationsInput>;
export type ListEngagementsArgs = z.infer<typeof ListEngagementsInput>;
export type ActivityFeedArgs = z.infer<typeof ActivityFeedInput>;
export type AttentionBriefArgs = z.infer<typeof AttentionBriefInput>;
export type RecordFinanceEventArgs = z.infer<typeof RecordFinanceEventInput>;
export type EngagementContextArgs = z.infer<typeof EngagementContextInput>;
export type LatestCorrespondenceArgs = z.infer<typeof LatestCorrespondenceInput>;

export function parseToolArgs<T>(schema: z.ZodType<T>, args: unknown): T {
  return schema.parse(args ?? {});
}
