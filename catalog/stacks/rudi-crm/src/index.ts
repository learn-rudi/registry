#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  crmErrorMessage,
  getActivityFeed,
  getAttentionBrief,
  getConfigStatus,
  getEngagementContext,
  getLatestCorrespondence,
  getSetupStatus,
  getUnknownDiscoveryDomains,
  listEngagements,
  listOrganizations,
  listPeople,
  listTriageQueue,
  logIngestBatch,
  recordDiscoveryObservations,
  recordFinanceEvent,
  runValidators,
  upsertInteraction,
} from "./contract.js";

function asText(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function asError(error: unknown) {
  return {
    ...asText({ error: crmErrorMessage(error) }),
    isError: true,
  };
}

const server = new Server(
  { name: "rudi-crm", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "rudi_crm_config_status",
      description:
        "Check RUDI CRM stack configuration without revealing database credentials.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "rudi_crm_setup_status",
      description:
        "Verify first-run readiness without exposing secrets: database connection, required CRM tables/functions/views, and validator status.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "rudi_crm_record_discovery_observations",
      description:
        "Record source metadata observations through the CRM discovery write contract. Use for addresses observed in email, calendar, chat, or similar metadata feeds.",
      inputSchema: {
        type: "object",
        properties: {
          observations: {
            type: "array",
            minItems: 1,
            maxItems: 500,
            items: {
              type: "object",
              properties: {
                source: { type: "string" },
                source_id: { type: "string" },
                source_thread_id: { type: "string" },
                observed_at: { type: "string" },
                address_role: {
                  type: "string",
                  enum: ["from", "to", "cc", "bcc", "attendee", "host", "sender", "recipient"],
                },
                address: { type: "string" },
                idempotency_key: { type: "string" },
                raw: { type: "object" },
              },
              required: ["source", "source_id", "observed_at", "address_role", "address"],
            },
          },
        },
        required: ["observations"],
      },
    },
    {
      name: "rudi_crm_log_ingest_batch",
      description:
        "Log a discovery or ingest batch after a source sweep, including counts and validator summary.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string" },
          window_start: { type: "string", description: "YYYY-MM-DD" },
          window_end: { type: "string", description: "YYYY-MM-DD" },
          domain_filter: { type: "string" },
          messages_seen: { type: "number" },
          messages_inserted: { type: "number" },
          messages_updated: { type: "number" },
          skipped_noise: { type: "number" },
          triage_count: { type: "number" },
          validator_result: { type: "string" },
          notes: { type: "string" },
        },
        required: ["source"],
      },
    },
    {
      name: "rudi_crm_upsert_interaction",
      description:
        "Write or update one CRM interaction through the idempotent database contract keyed by source and source_id. Replays update mutable fields without wiping existing classification links.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string" },
          source_id: { type: "string" },
          channel: {
            type: "string",
            description: "email, slack, calendar, meeting, call, sms, manual, or another CRM channel.",
          },
          direction: { type: "string", enum: ["inbound", "outbound"] },
          occurred_at: {
            type: "string",
            format: "date-time",
            description: "ISO-8601 timestamp.",
          },
          subject: { type: "string" },
          summary: { type: "string" },
          source_url: { type: "string" },
          engagement_id: { type: "string", format: "uuid" },
          thread_id: { type: "string", format: "uuid" },
          created_by_actor_id: { type: "string", format: "uuid" },
          related_interaction_id: { type: "string", format: "uuid" },
        },
        required: [
          "source",
          "source_id",
          "channel",
          "direction",
          "occurred_at",
          "subject",
          "summary",
        ],
      },
    },
    {
      name: "rudi_crm_record_finance_event",
      description:
        "Record a finance event (budget/estimate/proposal/contract/invoice/payment/refund/expense/adjustment) for an engagement through the idempotent database contract. Keyed by (source, source_id); replays that change amount, event_type, currency, or direction are rejected to preserve finance history.",
      inputSchema: {
        type: "object",
        properties: {
          engagement_id: { type: "string", format: "uuid" },
          event_type: {
            type: "string",
            enum: [
              "budget",
              "estimate",
              "proposal",
              "contract",
              "invoice",
              "payment",
              "refund",
              "expense",
              "adjustment",
            ],
          },
          amount: {
            type: ["number", "string"],
            description: "Non-negative magnitude as a number or decimal string.",
          },
          direction: {
            type: "string",
            enum: ["positive", "negative"],
            description: "Defaults to positive.",
          },
          currency: {
            type: "string",
            description: "ISO 4217 three-letter uppercase code. Defaults to USD.",
          },
          occurred_at: {
            type: "string",
            format: "date-time",
            description: "ISO-8601 timestamp with offset.",
          },
          source: {
            type: "string",
            enum: [
              "manual",
              "gmail",
              "calendar",
              "otter",
              "slack",
              "contract",
              "invoice",
              "payment_processor",
              "import",
            ],
          },
          source_id: {
            type: "string",
            description: "Stable provider id. Required for non-manual sources.",
          },
          source_url: { type: "string" },
          source_interaction_id: {
            type: "string",
            format: "uuid",
            description: "Evidence interaction; must belong to the same engagement.",
          },
          source_deliverable_id: {
            type: "string",
            format: "uuid",
            description: "Evidence deliverable; must belong to the same engagement.",
          },
          created_by_actor_id: { type: "string", format: "uuid" },
          notes: { type: "string" },
        },
        required: ["engagement_id", "event_type", "amount", "occurred_at", "source"],
      },
    },
    {
      name: "rudi_crm_run_validators",
      description:
        "Run the zero-tolerance CRM validator views and return violation counts.",
      inputSchema: {
        type: "object",
        properties: {
          include_rows: {
            type: "boolean",
            description: "Include up to 25 offending rows for validators with violations.",
          },
        },
      },
    },
    {
      name: "rudi_crm_list_people",
      description:
        "List CRM people with organization and engagement context. Supports bounded filters for organization, engagement, role, search text, and email presence.",
      inputSchema: {
        type: "object",
        properties: {
          organization_name: { type: "string" },
          organization_category: { type: "string" },
          engagement_id: { type: "string", format: "uuid" },
          engagement_name: { type: "string" },
          role: { type: "string" },
          search: { type: "string" },
          has_email: { type: "boolean" },
          limit: {
            type: "number",
            minimum: 1,
            maximum: 100,
            description: "Maximum rows to return, 1-100.",
          },
          offset: {
            type: "number",
            minimum: 0,
            description: "Rows to skip for pagination.",
          },
        },
      },
    },
    {
      name: "rudi_crm_list_organizations",
      description:
        "List CRM organizations with people, engagement, and latest interaction rollups.",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string" },
          search: { type: "string" },
          has_engagements: { type: "boolean" },
          limit: {
            type: "number",
            minimum: 1,
            maximum: 100,
            description: "Maximum rows to return, 1-100.",
          },
          offset: {
            type: "number",
            minimum: 0,
            description: "Rows to skip for pagination.",
          },
        },
      },
    },
    {
      name: "rudi_crm_list_engagements",
      description:
        "List CRM engagements with organization context, people counts, open next-action counts, and latest interaction timestamps.",
      inputSchema: {
        type: "object",
        properties: {
          organization_name: { type: "string" },
          organization_category: { type: "string" },
          pipeline_stage: { type: "string" },
          status: { type: "string" },
          priority: { type: "string" },
          search: { type: "string" },
          stale_days: {
            type: "number",
            minimum: 1,
            maximum: 3650,
            description: "Only include engagements without interactions in this many days.",
          },
          limit: {
            type: "number",
            minimum: 1,
            maximum: 100,
            description: "Maximum rows to return, 1-100.",
          },
          offset: {
            type: "number",
            minimum: 0,
            description: "Rows to skip for pagination.",
          },
        },
      },
    },
    {
      name: "rudi_crm_get_activity_feed",
      description:
        "Read a cross-engagement interaction timeline with engagement, organization, and thread context.",
      inputSchema: {
        type: "object",
        properties: {
          engagement_id: { type: "string", format: "uuid" },
          organization_name: { type: "string" },
          organization_category: { type: "string" },
          engagement_name: { type: "string" },
          source: { type: "string" },
          channel: { type: "string" },
          direction: { type: "string", enum: ["inbound", "outbound"] },
          since: {
            type: "string",
            format: "date-time",
            description: "Only include interactions at or after this ISO-8601 timestamp.",
          },
          until: {
            type: "string",
            format: "date-time",
            description: "Only include interactions at or before this ISO-8601 timestamp.",
          },
          limit: {
            type: "number",
            minimum: 1,
            maximum: 100,
            description: "Maximum rows to return, 1-100.",
          },
          offset: {
            type: "number",
            minimum: 0,
            description: "Rows to skip for pagination.",
          },
        },
      },
    },
    {
      name: "rudi_crm_get_attention_brief",
      description:
        "Return the CRM items needing attention: overdue next actions, undated open next actions, unanswered inbound interactions, and stale active engagements.",
      inputSchema: {
        type: "object",
        properties: {
          as_of: { type: "string", description: "YYYY-MM-DD" },
          stale_days: {
            type: "number",
            minimum: 1,
            maximum: 3650,
            description: "Engagements are stale when their latest interaction is older than this many days.",
          },
          limit: {
            type: "number",
            minimum: 1,
            maximum: 100,
            description: "Maximum rows to return per attention section, 1-100.",
          },
        },
      },
    },
    {
      name: "rudi_crm_list_triage_queue",
      description:
        "List unclassified CRM items from the triage queue. This is a review surface, not a failure.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum rows to return, 1-100." },
        },
      },
    },
    {
      name: "rudi_crm_get_unknown_discovery_domains",
      description:
        "List discovery domains that still need classification, excluding free-mail domains handled by address-level matching.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum rows to return, 1-100." },
        },
      },
    },
    {
      name: "rudi_crm_get_engagement_context",
      description:
        "Get a structured CRM context pack for one engagement or organization: engagement, organization, people, next actions, finance summary, and recent interactions.",
      inputSchema: {
        type: "object",
        properties: {
          engagement_id: { type: "string" },
          organization_name: { type: "string" },
          engagement_name: { type: "string" },
          recent_interactions_limit: {
            type: "number",
            description: "Maximum recent interactions to include, 1-100.",
          },
        },
      },
    },
    {
      name: "rudi_crm_get_latest_correspondence",
      description:
        "Read latest correspondence for an engagement or organization, optionally filtered by source.",
      inputSchema: {
        type: "object",
        properties: {
          engagement_id: { type: "string" },
          organization_name: { type: "string" },
          source: { type: "string" },
          limit: { type: "number", description: "Maximum rows to return, 1-100." },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments ?? {};

  try {
    switch (request.params.name) {
      case "rudi_crm_config_status":
        return asText(getConfigStatus());
      case "rudi_crm_setup_status":
        return asText(await getSetupStatus());
      case "rudi_crm_record_discovery_observations":
        return asText(await recordDiscoveryObservations(args));
      case "rudi_crm_log_ingest_batch":
        return asText(await logIngestBatch(args));
      case "rudi_crm_upsert_interaction":
        return asText(await upsertInteraction(args));
      case "rudi_crm_record_finance_event":
        return asText(await recordFinanceEvent(args));
      case "rudi_crm_run_validators":
        return asText(await runValidators(args));
      case "rudi_crm_list_people":
        return asText(await listPeople(args));
      case "rudi_crm_list_organizations":
        return asText(await listOrganizations(args));
      case "rudi_crm_list_engagements":
        return asText(await listEngagements(args));
      case "rudi_crm_get_activity_feed":
        return asText(await getActivityFeed(args));
      case "rudi_crm_get_attention_brief":
        return asText(await getAttentionBrief(args));
      case "rudi_crm_list_triage_queue":
        return asText(await listTriageQueue(args));
      case "rudi_crm_get_unknown_discovery_domains":
        return asText(await getUnknownDiscoveryDomains(args));
      case "rudi_crm_get_engagement_context":
        return asText(await getEngagementContext(args));
      case "rudi_crm_get_latest_correspondence":
        return asText(await getLatestCorrespondence(args));
      default:
        return asError(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    return asError(error);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
