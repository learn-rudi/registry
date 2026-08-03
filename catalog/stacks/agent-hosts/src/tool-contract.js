import { AGENT_HOST_ADAPTER_IDS, AgentHostError } from "./core.js";

const identitySchema = {
  type: "string",
  minLength: 1,
  maxLength: 200,
  pattern: "^[A-Za-z0-9][A-Za-z0-9:._/-]*$",
};

export const AGENT_HOST_TOOL_DEFINITIONS = Object.freeze([
  {
    name: "agent_host_list",
    description: "List the fixed governed Agent Host fleet. No provider is selected by default.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "agent_host_probe",
    description: "Probe one explicit Agent Host or all fixed hosts without invoking a model.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        adapter_id: {
          type: "string",
          enum: [...AGENT_HOST_ADAPTER_IDS],
          description: "Optional exact provider id. Omit only to probe the whole fleet.",
        },
      },
    },
  },
  {
    name: "agent_host_invoke",
    description: "Synchronously invoke one explicit governed Agent Host. V0 accepts synthetic nonprivate content only, may consume provider credits or subscription limits, exposes no tools to the child model, and never retries automatically.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "adapter_id",
        "content_class",
        "correlation_id",
        "invocation_id",
        "output_format",
        "prompt",
        "timeout_ms",
      ],
      properties: {
        adapter_id: {
          type: "string",
          enum: [...AGENT_HOST_ADAPTER_IDS],
          description: "Exact provider id; there is no default or fallback.",
        },
        content_class: {
          type: "string",
          enum: ["synthetic_nonprivate"],
          description: "Caller assertion required by the V0 data boundary.",
        },
        correlation_id: {
          ...identitySchema,
          description: "Caller-owned trace identifier.",
        },
        invocation_id: {
          ...identitySchema,
          description: "Caller-owned unique invocation identifier.",
        },
        output_format: {
          type: "string",
          enum: ["json", "text"],
          description: "Required validated output format.",
        },
        prompt: {
          type: "string",
          minLength: 1,
          maxLength: 200_000,
          description: "Synthetic nonprivate prompt supplied to the provider over stdin or HTTPS body.",
        },
        timeout_ms: {
          type: "integer",
          minimum: 1_000,
          maximum: 25_000,
          description: "Hard invocation timeout in milliseconds, bounded below the current RUDI router request ceiling.",
        },
      },
    },
  },
]);

export async function callAgentHostTool(service, name, args = {}) {
  switch (name) {
    case "agent_host_list":
      if (!args || typeof args !== "object" || Array.isArray(args)
        || Object.keys(args).length !== 0) {
        throw new AgentHostError("invalid_request", "agent_host_list accepts no arguments.");
      }
      return service.list();
    case "agent_host_probe":
      return service.probe(args);
    case "agent_host_invoke":
      return service.invoke(args);
    default:
      throw new AgentHostError("tool_not_found", "Agent Host tool is not registered.");
  }
}
