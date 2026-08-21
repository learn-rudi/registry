#!/usr/bin/env node
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

function decodeRaw(raw) {
  return Buffer.from(raw, "base64url").toString("utf-8");
}

function decodeBodyFromRaw(rawMessage) {
  const encodedBody = rawMessage.split("\r\n\r\n")[1].replace(/\r\n/g, "");
  return Buffer.from(encodedBody, "base64").toString("utf-8");
}

function normalizeMimeLineEndings(value) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
}

async function main() {
  const {
    GMAIL_HISTORY_TYPES,
    buildGmailDraftMessage,
    buildGmailRawMessage,
    normalizeGmailHistoryPage,
    normalizeGmailRawMessage,
    normalizeGmailSendResult,
    resolveRequestedAccount,
  } = await import("./src/gmail.ts");

  assert.deepEqual(GMAIL_HISTORY_TYPES, ["messageAdded", "messageDeleted"]);

  const originalMessage = {
    id: "msg-123",
    threadId: "thread-abc",
    payload: {
      headers: [
        { name: "Subject", value: "Client follow-up" },
        { name: "From", value: "Client Person <client@example.com>" },
        { name: "To", value: "Me <me@example.com>, Teammate <teammate@example.com>" },
        { name: "Cc", value: "Ops <ops@example.com>" },
        { name: "Message-ID", value: "<original-message@example.com>" },
        { name: "References", value: "<root-message@example.com>" },
      ],
    },
  };

  const threaded = buildGmailDraftMessage({
    body: "<p>Thanks, I will take a look.</p>",
    replyMessageId: "msg-123",
    replyAll: true,
    originalMessage,
    selfEmail: "me@example.com",
  });

  assert.equal(threaded.threadId, "thread-abc");
  assert.equal(threaded.to, "Client Person <client@example.com>, Teammate <teammate@example.com>, Ops <ops@example.com>");
  assert.equal(threaded.subject, "Re: Client follow-up");

  const threadedRaw = decodeRaw(threaded.raw);
  assert.match(threadedRaw, /^To: Client Person <client@example\.com>, Teammate <teammate@example\.com>, Ops <ops@example\.com>\r\n/);
  assert.match(threadedRaw, /\r\nSubject: Re: Client follow-up\r\n/);
  assert.match(threadedRaw, /\r\nIn-Reply-To: <original-message@example\.com>\r\n/);
  assert.match(threadedRaw, /\r\nReferences: <root-message@example\.com> <original-message@example\.com>\r\n/);
  assert.match(threadedRaw, /\r\nMIME-Version: 1\.0\r\n/);
  assert.match(threadedRaw, /\r\nContent-Type: text\/html; charset=utf-8\r\n/);
  assert.match(threadedRaw, /\r\nContent-Transfer-Encoding: base64\r\n\r\n/);
  assert.equal(decodeBodyFromRaw(threadedRaw), "<p>Thanks, I will take a look.</p>");

  const standalone = buildGmailDraftMessage({
    to: "new@example.com",
    subject: "New topic",
    body: "Plain text",
  });

  assert.equal(standalone.threadId, undefined);
  assert.equal(
    decodeRaw(standalone.raw),
    [
      "To: new@example.com",
      "Subject: New topic",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      "UGxhaW4gdGV4dA==",
    ].join("\r\n")
  );

  const serviceAccountMessage = buildGmailRawMessage({
    from: "service@example.com",
    to: "requester@example.com",
    subject: "Service response",
    body: "Completed",
  });
  assert.match(
    decodeRaw(serviceAccountMessage),
    /^From: service@example\.com\r\nTo: requester@example\.com\r\n/
  );

  const utf8Body = "First line — ok\n\nSecond line · emoji ✅";
  const utf8Standalone = buildGmailDraftMessage({
    to: "new@example.com",
    subject: "Update — café ✅",
    body: utf8Body,
  });
  const utf8StandaloneRaw = decodeRaw(utf8Standalone.raw);
  const encodedSubject = `=?UTF-8?B?${Buffer.from("Update — café ✅").toString("base64")}?=`;
  assert.match(utf8StandaloneRaw, new RegExp(`\\r\\nSubject: ${encodedSubject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r\\n`));
  assert.match(utf8StandaloneRaw, /\r\nContent-Type: text\/plain; charset="UTF-8"\r\n/);
  assert.match(utf8StandaloneRaw, /\r\nContent-Transfer-Encoding: base64\r\n\r\n/);
  assert.equal(decodeBodyFromRaw(utf8StandaloneRaw), normalizeMimeLineEndings(utf8Body));

  const plainReplyBody = "Line one — still plain\n\nLine two with · separator";
  const plainReply = buildGmailDraftMessage({
    body: plainReplyBody,
    replyMessageId: "msg-123",
    originalMessage,
  });
  const plainReplyRaw = decodeRaw(plainReply.raw);
  assert.equal(plainReply.contentType, 'text/plain; charset="UTF-8"');
  assert.match(plainReplyRaw, /\r\nContent-Type: text\/plain; charset="UTF-8"\r\n/);
  assert.equal(decodeBodyFromRaw(plainReplyRaw), normalizeMimeLineEndings(plainReplyBody));

  const updatedReplyRaw = buildGmailRawMessage({
    to: "client@example.com",
    cc: "ops@example.com",
    subject: "Re: Client follow-up",
    body: "<p>Updated body</p>",
    contentType: "text/html; charset=utf-8",
    inReplyTo: "<original-message@example.com>",
    references: "<root-message@example.com> <original-message@example.com>",
  });
  assert.equal(
    decodeRaw(updatedReplyRaw),
    [
      "To: client@example.com",
      "Cc: ops@example.com",
      "Subject: Re: Client follow-up",
      "In-Reply-To: <original-message@example.com>",
      "References: <root-message@example.com> <original-message@example.com>",
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      "PHA+VXBkYXRlZCBib2R5PC9wPg==",
    ].join("\r\n")
  );

  assert.equal(resolveRequestedAccount({ account: "work@example.com" }, "personal@example.com"), "work@example.com");
  assert.equal(resolveRequestedAccount({}, "personal@example.com"), "personal@example.com");
  assert.equal(resolveRequestedAccount({}, null), null);
  assert.throws(
    () => resolveRequestedAccount({ account: " " }, "personal@example.com"),
    /account must be a non-empty string/
  );

  assert.deepEqual(
    normalizeGmailSendResult({
      id: "gmail-message-123",
      threadId: "gmail-thread-456",
      historyId: "789",
      labelIds: ["SENT"],
    }),
    {
      messageId: "gmail-message-123",
      threadId: "gmail-thread-456",
      historyId: "789",
      labelIds: ["SENT"],
    }
  );
  assert.throws(
    () => normalizeGmailSendResult({ id: "gmail-message-123" }),
    /threadId is required/
  );

  assert.deepEqual(
    normalizeGmailHistoryPage({
      history: [
        {
          id: "101",
          messagesAdded: [
            {
              message: {
                id: "gmail-message-101",
                threadId: "gmail-thread-101",
                labelIds: ["INBOX", "UNREAD"],
              },
            },
          ],
        },
        {
          id: "105",
          messagesAdded: [
            {
              message: {
                id: "gmail-message-105",
                threadId: "gmail-thread-105",
                labelIds: ["SENT"],
              },
            },
          ],
          messagesDeleted: [
            {
              message: {
                id: "gmail-message-deleted-105",
                threadId: "gmail-thread-deleted-105",
              },
            },
          ],
        },
      ],
      nextPageToken: "next-page",
      historyId: "110",
    }, "100"),
    {
      startHistoryId: "100",
      records: [
        {
          historyId: "101",
          messagesAdded: [
            {
              messageId: "gmail-message-101",
              threadId: "gmail-thread-101",
              labelIds: ["INBOX", "UNREAD"],
            },
          ],
          messagesDeleted: [],
        },
        {
          historyId: "105",
          messagesAdded: [
            {
              messageId: "gmail-message-105",
              threadId: "gmail-thread-105",
              labelIds: ["SENT"],
            },
          ],
          messagesDeleted: [
            {
              messageId: "gmail-message-deleted-105",
              threadId: "gmail-thread-deleted-105",
              labelIds: [],
            },
          ],
        },
      ],
      nextPageToken: "next-page",
      historyId: "110",
    }
  );
  assert.throws(
    () => normalizeGmailHistoryPage({
      history: [{ id: "105" }, { id: "101" }],
      historyId: "110",
    }, "100"),
    /strictly increasing/
  );

  assert.deepEqual(
    normalizeGmailRawMessage({
      id: "gmail-message-raw",
      threadId: "gmail-thread-raw",
      historyId: "111",
      internalDate: "1785372000000",
      labelIds: ["INBOX"],
      raw: "UmF3IG1lc3NhZ2U",
    }),
    {
      messageId: "gmail-message-raw",
      threadId: "gmail-thread-raw",
      historyId: "111",
      internalDate: "1785372000000",
      labelIds: ["INBOX"],
      rawBase64Url: "UmF3IG1lc3NhZ2U",
    }
  );
  assert.equal(
    normalizeGmailRawMessage({
      id: "gmail-message-long-raw",
      threadId: "gmail-thread-long-raw",
      labelIds: ["INBOX"],
      raw: Buffer.alloc(400, 0x61).toString("base64url"),
    }).rawBase64Url.length > 512,
    true
  );
  assert.equal(
    normalizeGmailRawMessage({
      id: "gmail-message-padded-raw",
      threadId: "gmail-thread-padded-raw",
      labelIds: ["INBOX"],
      raw: "SGVsbG8=",
    }).rawBase64Url,
    "SGVsbG8"
  );
  assert.throws(
    () => normalizeGmailRawMessage({
      id: "gmail-message-raw",
      threadId: "gmail-thread-raw",
      raw: "not base64url!",
    }),
    /raw/
  );

  await testGmailToolSchemas();
}

async function testGmailToolSchemas() {
  const stateDir = mkdtempSync(path.join(tmpdir(), "google-workspace-gmail-tools-"));
  const client = new Client(
    { name: "google-workspace-gmail-test", version: "0.0.0" },
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

    for (const name of [
      "gmail_profile",
      "gmail_history_list",
      "gmail_get_raw",
      "gmail_draft_get",
      "gmail_message_trash",
      "gmail_message_untrash",
      "gmail_message_delete",
      "gmail_label_list",
      "gmail_label_create",
      "gmail_label_update",
      "gmail_label_delete",
      "gmail_message_modify_labels",
      "gmail_message_archive",
      "gmail_message_mark_read",
      "gmail_message_mark_unread",
      "gmail_message_star",
      "gmail_message_unstar",
      "gmail_message_batch_get",
      "gmail_thread_batch_get",
      "gmail_message_batch_modify_labels",
      "gmail_message_batch_trash",
      "gmail_message_batch_untrash",
      "gmail_message_batch_delete",
      "gmail_forward",
    ]) {
      assert(byName[name], `${name} must be exposed`);
      assert(byName[name].inputSchema.properties.account, `${name} must support account override`);
    }

    assert.deepEqual(byName.gmail_draft_get.inputSchema.required, ["draft_id"]);
    assert.deepEqual(byName.gmail_history_list.inputSchema.required, ["start_history_id"]);
    assert.deepEqual(byName.gmail_get_raw.inputSchema.required, ["message_id"]);
    assert(byName.gmail_history_list.inputSchema.properties.next_page_token, "gmail_history_list must support pagination");
    assert(byName.gmail_history_list.inputSchema.properties.label_id, "gmail_history_list must support label filtering");
    assert.deepEqual(byName.gmail_message_delete.inputSchema.required, ["message_id"]);
    assert.deepEqual(byName.gmail_label_create.inputSchema.required, ["name"]);
    assert.deepEqual(byName.gmail_message_modify_labels.inputSchema.required, ["message_id"]);
    assert.deepEqual(byName.gmail_message_batch_get.inputSchema.required, ["message_ids"]);
    assert.deepEqual(byName.gmail_thread_batch_get.inputSchema.required, ["thread_ids"]);
    assert.deepEqual(byName.gmail_message_batch_modify_labels.inputSchema.required, ["message_ids"]);
    assert.deepEqual(byName.gmail_forward.inputSchema.required, ["message_id", "to"]);
    assert(byName.gmail_send.inputSchema.properties.attachments, "gmail_send must support attachments");
    assert(byName.gmail_send.inputSchema.properties.reply_message_id, "gmail_send must support threaded send replies");
    assert(byName.gmail_draft.inputSchema.properties.attachments, "gmail_draft must support attachments");
    assert(byName.gmail_draft_list.inputSchema.properties.next_page_token, "gmail_draft_list must support pagination");
    assert(byName.gmail_search.inputSchema.properties.next_page_token, "gmail_search must support pagination");
    assert(byName.gmail_reply.inputSchema.properties.attachments, "gmail_reply must support attachments");
  } finally {
    await client.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
