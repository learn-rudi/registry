#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_BASE = "https://api.tally.so";
const API_KEY = process.env.TALLY_API_KEY;

if (!API_KEY) {
  console.error("Error: TALLY_API_KEY environment variable is required");
  process.exit(1);
}

// API Helper
async function tallyRequest(
  endpoint: string,
  method: string = "GET",
  body?: any
) {
  const url = `${API_BASE}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Tally API error (${response.status}): ${errorText}`
    );
  }

  return response.json();
}

// Tool Handlers
const tools = [
  {
    name: "tally_list_forms",
    description: "List all Tally forms in your account",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of forms to return (default: 50)",
        },
        offset: {
          type: "number",
          description: "Number of forms to skip (for pagination)",
        },
      },
    },
  },
  {
    name: "tally_get_form",
    description: "Get detailed information about a specific form including fields and settings",
    inputSchema: {
      type: "object",
      properties: {
        form_id: {
          type: "string",
          description: "The form ID (e.g., 'q4G4l9')",
        },
      },
      required: ["form_id"],
    },
  },
  {
    name: "tally_create_form",
    description: "Create a new Tally form with specified blocks and settings",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Form title",
        },
        blocks: {
          type: "array",
          description: "Array of form blocks (fields, text, etc.)",
          items: {
            type: "object",
          },
        },
      },
      required: ["title"],
    },
  },
  {
    name: "tally_update_form",
    description: "Update form settings or blocks",
    inputSchema: {
      type: "object",
      properties: {
        form_id: {
          type: "string",
          description: "The form ID to update",
        },
        title: {
          type: "string",
          description: "New form title",
        },
        blocks: {
          type: "array",
          description: "Updated form blocks",
          items: {
            type: "object",
          },
        },
      },
      required: ["form_id"],
    },
  },
  {
    name: "tally_delete_form",
    description: "Delete a form permanently",
    inputSchema: {
      type: "object",
      properties: {
        form_id: {
          type: "string",
          description: "The form ID to delete",
        },
      },
      required: ["form_id"],
    },
  },
  {
    name: "tally_list_fields",
    description: "List all fields in a specific form",
    inputSchema: {
      type: "object",
      properties: {
        form_id: {
          type: "string",
          description: "The form ID",
        },
      },
      required: ["form_id"],
    },
  },
  {
    name: "tally_list_submissions",
    description: "Get submissions for a specific form (returns all submissions with questions and responses)",
    inputSchema: {
      type: "object",
      properties: {
        form_id: {
          type: "string",
          description: "The form ID",
        },
        since: {
          type: "string",
          description: "ISO date string - only return submissions after this date (optional)",
        },
      },
      required: ["form_id"],
    },
  },
  {
    name: "tally_get_submission",
    description: "Get a specific submission by ID",
    inputSchema: {
      type: "object",
      properties: {
        submission_id: {
          type: "string",
          description: "The submission ID",
        },
      },
      required: ["submission_id"],
    },
  },
  {
    name: "tally_filter_submissions",
    description: "Filter submissions by field values (e.g., by organization)",
    inputSchema: {
      type: "object",
      properties: {
        form_id: {
          type: "string",
          description: "The form ID",
        },
        filters: {
          type: "object",
          description: "Field filters (e.g., {organization: 'Acme Corp'})",
          additionalProperties: {
            type: "string",
          },
        },
        limit: {
          type: "number",
          description: "Maximum number of results",
        },
      },
      required: ["form_id", "filters"],
    },
  },
  {
    name: "tally_export_submissions",
    description: "Export form submissions to CSV or JSON",
    inputSchema: {
      type: "object",
      properties: {
        form_id: {
          type: "string",
          description: "The form ID",
        },
        format: {
          type: "string",
          enum: ["csv", "json"],
          description: "Export format (csv or json)",
        },
      },
      required: ["form_id", "format"],
    },
  },
  {
    name: "tally_generate_prefill_url",
    description: "Generate a Tally form URL with pre-filled fields using URL parameters",
    inputSchema: {
      type: "object",
      properties: {
        form_id: {
          type: "string",
          description: "The form ID",
        },
        prefill_data: {
          type: "object",
          description: "Field name to value mapping (e.g., {organization: 'Acme', email: 'user@acme.com'})",
          additionalProperties: {
            type: "string",
          },
        },
        embed: {
          type: "boolean",
          description: "Generate embed URL instead of regular form URL",
        },
      },
      required: ["form_id", "prefill_data"],
    },
  },
  {
    name: "tally_get_analytics",
    description: "Get form analytics including response count, completion rate, and average time",
    inputSchema: {
      type: "object",
      properties: {
        form_id: {
          type: "string",
          description: "The form ID",
        },
      },
      required: ["form_id"],
    },
  },
];

// MCP Server
const server = new Server(
  {
    name: "tally-forms",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "tally_list_forms": {
        const { limit = 50, offset = 0 } = args as any;
        const page = Math.floor(offset / limit) + 1;
        const data = await tallyRequest(
          `/forms?limit=${limit}&page=${page}`
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "tally_get_form": {
        const { form_id } = args as any;
        const data = await tallyRequest(`/forms/${form_id}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "tally_create_form": {
        const { title, blocks = [] } = args as any;
        const data = await tallyRequest("/forms", "POST", {
          title,
          blocks,
        });
        return {
          content: [
            {
              type: "text",
              text: `Form created successfully!\n\n${JSON.stringify(
                data,
                null,
                2
              )}`,
            },
          ],
        };
      }

      case "tally_update_form": {
        const { form_id, title, blocks } = args as any;
        const updateData: any = {};
        if (title) updateData.title = title;
        if (blocks) updateData.blocks = blocks;

        const data = await tallyRequest(
          `/forms/${form_id}`,
          "PATCH",
          updateData
        );
        return {
          content: [
            {
              type: "text",
              text: `Form updated successfully!\n\n${JSON.stringify(
                data,
                null,
                2
              )}`,
            },
          ],
        };
      }

      case "tally_delete_form": {
        const { form_id } = args as any;
        await tallyRequest(`/forms/${form_id}`, "DELETE");
        return {
          content: [
            {
              type: "text",
              text: `Form ${form_id} deleted successfully.`,
            },
          ],
        };
      }

      case "tally_list_fields": {
        const { form_id } = args as any;
        const formData = await tallyRequest(`/forms/${form_id}`);
        const fields = formData.blocks?.filter(
          (block: any) => block.type === "INPUT"
        ) || [];
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(fields, null, 2),
            },
          ],
        };
      }

      case "tally_list_submissions": {
        const { form_id, since } = args as any;
        // Note: Tally API doesn't support limit/page parameters on submissions endpoint
        let endpoint = `/forms/${form_id}/submissions`;
        if (since) {
          endpoint += `?since=${since}`;
        }
        const data = await tallyRequest(endpoint);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "tally_get_submission": {
        const { submission_id } = args as any;
        const data = await tallyRequest(`/submissions/${submission_id}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "tally_filter_submissions": {
        const { form_id, filters, limit = 100 } = args as any;
        const allSubmissions = await tallyRequest(
          `/forms/${form_id}/submissions`
        );

        const submissions = allSubmissions.submissions || [];
        const questions = allSubmissions.questions || [];

        // Filter submissions based on response answers
        const filtered = submissions.filter((submission: any) => {
          return Object.entries(filters).every(([questionTitle, expectedValue]) => {
            // Find question by title
            const question = questions.find((q: any) =>
              q.title.toLowerCase().includes(questionTitle.toLowerCase())
            );
            if (!question) return false;

            // Find response for this question in this submission
            const response = submission.responses?.find(
              (r: any) => r.questionId === question.id
            );
            if (!response) return false;

            // Check if answer matches expected value
            const answer = Array.isArray(response.answer)
              ? response.answer.join(', ')
              : String(response.answer);
            return answer.toLowerCase().includes(String(expectedValue).toLowerCase());
          });
        }).slice(0, limit);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { submissions: filtered, count: filtered?.length || 0 },
                null,
                2
              ),
            },
          ],
        };
      }

      case "tally_export_submissions": {
        const { form_id, format } = args as any;
        const submissionsData = await tallyRequest(
          `/forms/${form_id}/submissions`
        );

        if (format === "csv") {
          // Convert to CSV
          const submissions = submissionsData.submissions || [];
          const questions = submissionsData.questions || [];

          if (submissions.length === 0) {
            return {
              content: [
                { type: "text", text: "No submissions to export." },
              ],
            };
          }

          // Create CSV header with question titles
          const headers = [
            "submission_id",
            "submitted_at",
            "is_completed",
            ...questions.map((q: any) => q.title.replace(/,/g, ';')),
          ];

          // Create CSV rows
          const rows = submissions.map((submission: any) => {
            const row = [
              submission.id,
              submission.submittedAt,
              submission.isCompleted,
            ];

            // Add answer for each question
            questions.forEach((question: any) => {
              const response = submission.responses?.find(
                (r: any) => r.questionId === question.id
              );
              if (response) {
                const answer = Array.isArray(response.answer)
                  ? response.answer.join('; ')
                  : String(response.answer || '');
                row.push(answer.replace(/,/g, ';'));
              } else {
                row.push('');
              }
            });

            return row.join(",");
          });

          const csv = [headers.join(","), ...rows].join("\n");
          return {
            content: [{ type: "text", text: csv }],
          };
        } else {
          // JSON format
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(submissionsData, null, 2),
              },
            ],
          };
        }
      }

      case "tally_generate_prefill_url": {
        const { form_id, prefill_data, embed = false } = args as any;
        const baseUrl = embed
          ? `https://tally.so/embed/${form_id}`
          : `https://tally.so/r/${form_id}`;

        const params = new URLSearchParams();
        Object.entries(prefill_data).forEach(([key, value]) => {
          params.append(key, value as string);
        });

        const url = `${baseUrl}?${params.toString()}`;
        return {
          content: [
            {
              type: "text",
              text: `Pre-filled URL generated:\n\n${url}\n\nFields:\n${JSON.stringify(
                prefill_data,
                null,
                2
              )}`,
            },
          ],
        };
      }

      case "tally_get_analytics": {
        const { form_id } = args as any;
        // Get form data and submissions
        const [formData, submissionsData] = await Promise.all([
          tallyRequest(`/forms/${form_id}`),
          tallyRequest(`/forms/${form_id}/submissions`),
        ]);

        const submissions = submissionsData.submissions || [];
        const analytics = {
          form_id,
          form_title: formData.name || formData.title,
          total_submissions: submissions.length,
          completed_submissions: submissions.filter((s: any) => s.isCompleted).length,
          partial_submissions: submissions.filter((s: any) => !s.isCompleted).length,
          last_submission: submissions[0]?.submittedAt || "No submissions yet",
          form_created: formData.createdAt,
          form_status: formData.status,
          total_questions: submissionsData.questions?.length || 0,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(analytics, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Tally MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
