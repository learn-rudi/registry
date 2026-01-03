#!/usr/bin/env node
/**
 * Slack MCP Server
 * Send and read messages via Slack
 *
 * Usage:
 *   - As MCP: Run without args, speaks JSON-RPC
 *   - As API: import { sendMessage, listChannels, readChannel, ... } from './index'
 *   - As CLI: node index.ts send <channel> <text> | channels | read <channel> | search <query>
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebClient } from "@slack/web-api";
import { createReadStream } from "fs";
import { basename } from "path";
import { homedir } from "os";

// =============================================================================
// CORE API - The actual functionality
// =============================================================================

// Initialize Slack client (lazy - will fail if token not set when used)
function getClient(): WebClient {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN environment variable not set");
  }
  return new WebClient(token);
}

// Default channel (can be overridden per call)
const DEFAULT_CHANNEL = process.env.SLACK_CHANNEL_ID;

export interface SendMessageResult {
  ok: boolean;
  channel: string;
  ts: string;
  message?: string;
}

export interface Channel {
  id: string;
  name: string;
  is_private: boolean;
  num_members: number;
}

export interface Message {
  ts: string;
  user: string;
  text: string;
  thread_ts?: string;
}

export interface SearchMatch {
  channel: string;
  user: string;
  text: string;
  ts: string;
  permalink: string;
}

export interface UserInfo {
  id: string;
  name: string;
  real_name: string;
  email?: string;
  title?: string;
  is_admin: boolean;
}

/**
 * Send a message to a Slack channel
 * @param text - Message text (supports Slack markdown)
 * @param channel - Channel ID or name (uses default if not provided)
 * @param thread_ts - Thread timestamp to reply to (optional)
 */
export async function sendMessage(
  text: string,
  channel?: string,
  thread_ts?: string
): Promise<SendMessageResult> {
  const slack = getClient();
  const targetChannel = channel || DEFAULT_CHANNEL;

  if (!targetChannel) {
    throw new Error("No channel specified and no default channel configured");
  }

  const result = await slack.chat.postMessage({
    channel: targetChannel,
    text,
    thread_ts,
  });

  return {
    ok: result.ok === true,
    channel: targetChannel,
    ts: result.ts || "",
    message: `Message sent to ${targetChannel}`,
  };
}

/**
 * List available Slack channels
 * @param limit - Max channels to return (default: 100)
 */
export async function listChannels(limit = 100): Promise<Channel[]> {
  const slack = getClient();

  const result = await slack.conversations.list({
    limit,
    types: "public_channel,private_channel",
  });

  return (result.channels || []).map((ch) => ({
    id: ch.id || "",
    name: ch.name || "",
    is_private: ch.is_private || false,
    num_members: ch.num_members || 0,
  }));
}

/**
 * Read recent messages from a channel
 * @param channel - Channel ID
 * @param limit - Number of messages (default: 20)
 */
export async function readChannel(channel: string, limit = 20): Promise<Message[]> {
  const slack = getClient();

  const result = await slack.conversations.history({
    channel,
    limit,
  });

  return (result.messages || []).map((msg) => ({
    ts: msg.ts || "",
    user: msg.user || "",
    text: msg.text || "",
    thread_ts: msg.thread_ts,
  }));
}

/**
 * Search for messages
 * @param query - Search query
 * @param limit - Max results (default: 20)
 */
export async function searchMessages(query: string, limit = 20): Promise<SearchMatch[]> {
  const slack = getClient();

  const result = await slack.search.messages({
    query,
    count: limit,
  });

  return (result.messages?.matches || []).map((msg) => ({
    channel: msg.channel?.name || "",
    user: msg.user || "",
    text: msg.text || "",
    ts: msg.ts || "",
    permalink: msg.permalink || "",
  }));
}

/**
 * Update an existing message
 * @param channel - Channel ID
 * @param ts - Message timestamp
 * @param text - New message text
 */
export async function updateMessage(channel: string, ts: string, text: string): Promise<boolean> {
  const slack = getClient();

  await slack.chat.update({
    channel,
    ts,
    text,
  });

  return true;
}

/**
 * Add an emoji reaction to a message
 * @param channel - Channel ID
 * @param ts - Message timestamp
 * @param emoji - Emoji name without colons (e.g., 'thumbsup')
 */
export async function addReaction(channel: string, ts: string, emoji: string): Promise<boolean> {
  const slack = getClient();

  await slack.reactions.add({
    channel,
    timestamp: ts,
    name: emoji,
  });

  return true;
}

/**
 * Upload a file to a channel
 * @param channel - Channel ID
 * @param filePath - Local file path to upload
 * @param title - File title (optional)
 * @param comment - Initial comment (optional)
 */
export async function uploadFile(
  channel: string,
  filePath: string,
  title?: string,
  comment?: string
): Promise<{ name: string; permalink: string }> {
  const slack = getClient();

  const expandedPath = filePath.replace(/^~/, homedir());
  const fileName = basename(expandedPath);

  const result = await slack.files.uploadV2({
    channel_id: channel,
    file: createReadStream(expandedPath),
    filename: fileName,
    title: title || fileName,
    initial_comment: comment,
  }) as any;

  return {
    name: result.file?.name || fileName,
    permalink: result.file?.permalink || "uploaded",
  };
}

/**
 * Get user info by ID or email
 * @param options - Either user_id or email must be provided
 */
export async function getUser(options: { user_id?: string; email?: string }): Promise<UserInfo> {
  const slack = getClient();

  let user;

  if (options.user_id) {
    const result = await slack.users.info({
      user: options.user_id,
    });
    user = result.user;
  } else if (options.email) {
    const result = await slack.users.lookupByEmail({
      email: options.email,
    });
    user = result.user;
  } else {
    throw new Error("Provide user_id or email");
  }

  return {
    id: user?.id || "",
    name: user?.name || "",
    real_name: user?.real_name || "",
    email: user?.profile?.email,
    title: user?.profile?.title,
    is_admin: user?.is_admin || false,
  };
}

// =============================================================================
// MCP SERVER - Thin wrapper around core API
// =============================================================================

const server = new Server(
  { name: "slack", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "slack_send_message",
      description: "Send a message to a Slack channel or user",
      inputSchema: {
        type: "object",
        properties: {
          channel: {
            type: "string",
            description: "Channel ID or name (e.g., #general, C0123456789). Uses default if not provided.",
          },
          text: {
            type: "string",
            description: "Message text (supports Slack markdown)",
          },
          thread_ts: {
            type: "string",
            description: "Thread timestamp to reply to (optional)",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "slack_list_channels",
      description: "List available Slack channels",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max channels to return (default: 100)",
          },
        },
      },
    },
    {
      name: "slack_read_channel",
      description: "Read recent messages from a channel",
      inputSchema: {
        type: "object",
        properties: {
          channel: {
            type: "string",
            description: "Channel ID",
          },
          limit: {
            type: "number",
            description: "Number of messages (default: 20)",
          },
        },
        required: ["channel"],
      },
    },
    {
      name: "slack_search",
      description: "Search for messages",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          limit: {
            type: "number",
            description: "Max results (default: 20)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "slack_update_message",
      description: "Update an existing message",
      inputSchema: {
        type: "object",
        properties: {
          channel: {
            type: "string",
            description: "Channel ID",
          },
          ts: {
            type: "string",
            description: "Message timestamp",
          },
          text: {
            type: "string",
            description: "New message text",
          },
        },
        required: ["channel", "ts", "text"],
      },
    },
    {
      name: "slack_add_reaction",
      description: "Add an emoji reaction to a message",
      inputSchema: {
        type: "object",
        properties: {
          channel: {
            type: "string",
            description: "Channel ID",
          },
          ts: {
            type: "string",
            description: "Message timestamp",
          },
          emoji: {
            type: "string",
            description: "Emoji name without colons (e.g., 'thumbsup')",
          },
        },
        required: ["channel", "ts", "emoji"],
      },
    },
    {
      name: "slack_upload_file",
      description: "Upload a file to a channel",
      inputSchema: {
        type: "object",
        properties: {
          channel: {
            type: "string",
            description: "Channel ID",
          },
          file_path: {
            type: "string",
            description: "Local file path to upload",
          },
          title: {
            type: "string",
            description: "File title (optional)",
          },
          comment: {
            type: "string",
            description: "Initial comment (optional)",
          },
        },
        required: ["channel", "file_path"],
      },
    },
    {
      name: "slack_get_user",
      description: "Get user info by ID or email",
      inputSchema: {
        type: "object",
        properties: {
          user_id: {
            type: "string",
            description: "User ID (e.g., U0123456789)",
          },
          email: {
            type: "string",
            description: "User email (alternative to user_id)",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "slack_send_message") {
      const result = await sendMessage(
        args?.text as string,
        args?.channel as string | undefined,
        args?.thread_ts as string | undefined
      );
      return {
        content: [{
          type: "text",
          text: `Message sent to ${result.channel}\nTimestamp: ${result.ts}`,
        }],
      };
    }

    if (name === "slack_list_channels") {
      const channels = await listChannels(args?.limit as number);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(channels, null, 2),
        }],
      };
    }

    if (name === "slack_read_channel") {
      const messages = await readChannel(args?.channel as string, args?.limit as number);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(messages, null, 2),
        }],
      };
    }

    if (name === "slack_search") {
      const matches = await searchMessages(args?.query as string, args?.limit as number);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(matches, null, 2),
        }],
      };
    }

    if (name === "slack_update_message") {
      await updateMessage(args?.channel as string, args?.ts as string, args?.text as string);
      return {
        content: [{ type: "text", text: "Message updated" }],
      };
    }

    if (name === "slack_add_reaction") {
      await addReaction(args?.channel as string, args?.ts as string, args?.emoji as string);
      return {
        content: [{ type: "text", text: `Added :${args?.emoji}: reaction` }],
      };
    }

    if (name === "slack_upload_file") {
      const result = await uploadFile(
        args?.channel as string,
        args?.file_path as string,
        args?.title as string | undefined,
        args?.comment as string | undefined
      );
      return {
        content: [{
          type: "text",
          text: `File uploaded: ${result.name}\nURL: ${result.permalink}`,
        }],
      };
    }

    if (name === "slack_get_user") {
      const user = await getUser({
        user_id: args?.user_id as string | undefined,
        email: args?.email as string | undefined,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(user, null, 2),
        }],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// =============================================================================
// ENTRY POINT
// =============================================================================

const args = process.argv.slice(2);

// CLI mode
if (args.length > 0 && ["send", "channels", "read", "search", "user"].includes(args[0])) {
  const command = args[0];

  (async () => {
    try {
      if (command === "send") {
        // send <channel> <text>
        if (args.length < 3) {
          console.error("Usage: node index.ts send <channel> <text>");
          process.exit(1);
        }
        const result = await sendMessage(args[2], args[1]);
        console.log(`Message sent to ${result.channel} (ts: ${result.ts})`);
      } else if (command === "channels") {
        // channels [limit]
        const limit = args[1] ? parseInt(args[1]) : 100;
        const channels = await listChannels(limit);
        console.log(JSON.stringify(channels, null, 2));
      } else if (command === "read") {
        // read <channel> [limit]
        if (args.length < 2) {
          console.error("Usage: node index.ts read <channel> [limit]");
          process.exit(1);
        }
        const limit = args[2] ? parseInt(args[2]) : 20;
        const messages = await readChannel(args[1], limit);
        console.log(JSON.stringify(messages, null, 2));
      } else if (command === "search") {
        // search <query> [limit]
        if (args.length < 2) {
          console.error("Usage: node index.ts search <query> [limit]");
          process.exit(1);
        }
        const limit = args[2] ? parseInt(args[2]) : 20;
        const matches = await searchMessages(args[1], limit);
        console.log(JSON.stringify(matches, null, 2));
      } else if (command === "user") {
        // user <id-or-email>
        if (args.length < 2) {
          console.error("Usage: node index.ts user <id-or-email>");
          process.exit(1);
        }
        const query = args[1];
        const user = await getUser(
          query.includes("@") ? { email: query } : { user_id: query }
        );
        console.log(JSON.stringify(user, null, 2));
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  })();
}
// MCP mode: no args, JSON-RPC over stdio
else {
  const transport = new StdioServerTransport();
  server.connect(transport).catch(console.error);
}
