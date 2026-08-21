#!/usr/bin/env node
const assert = require("node:assert/strict");

async function main() {
  const {
    gmailDiscoveryToolDefinitions,
    runGmailDiscoveryTool,
  } = await import("./src/gmail-discovery.ts");

  const accountInput = {
    type: "string",
    description: "Configured Google account",
  };
  const definitions = gmailDiscoveryToolDefinitions(accountInput);
  assert.deepEqual(
    definitions.map((definition) => definition.name),
    ["gmail_profile", "gmail_history_list"]
  );
  assert.equal(definitions[0].inputSchema.properties.account, accountInput);
  assert.deepEqual(definitions[1].inputSchema.required, ["start_history_id"]);
  assert.equal(definitions[1].inputSchema.properties.max_results.maximum, 500);

  const profileCalls = [];
  const profileResult = await runGmailDiscoveryTool(
    "gmail_profile",
    {
      users: {
        getProfile: async (request) => {
          profileCalls.push(request);
          return {
            data: {
              emailAddress: "rudi@learnrudi.com",
              messagesTotal: 12,
              threadsTotal: 7,
              historyId: "100",
              providerPrivateField: "must-not-leak",
            },
          };
        },
      },
    },
    undefined
  );
  assert.deepEqual(profileCalls, [{ userId: "me" }]);
  assert.deepEqual(JSON.parse(profileResult.content[0].text), {
    emailAddress: "rudi@learnrudi.com",
    messagesTotal: 12,
    threadsTotal: 7,
    historyId: "100",
  });

  let historyRequest;
  const historyResult = await runGmailDiscoveryTool(
    "gmail_history_list",
    {
      users: {
        history: {
          list: async (request) => {
            historyRequest = request;
            return {
              data: {
                history: [{
                  id: "101",
                  messagesAdded: [{
                    message: {
                      id: "message-added",
                      threadId: "thread-added",
                      labelIds: ["INBOX"],
                    },
                  }],
                  messagesDeleted: [{
                    message: {
                      id: "message-deleted",
                      threadId: "thread-deleted",
                    },
                  }],
                }],
                nextPageToken: "next-output-page",
                historyId: "102",
              },
            };
          },
        },
      },
    },
    {
      start_history_id: " 100 ",
      max_results: 25,
      next_page_token: " next-input-page ",
      label_id: " INBOX ",
    }
  );
  assert.deepEqual(historyRequest, {
    userId: "me",
    startHistoryId: "100",
    historyTypes: ["messageAdded", "messageDeleted"],
    maxResults: 25,
    pageToken: "next-input-page",
    labelId: "INBOX",
  });
  assert.deepEqual(JSON.parse(historyResult.content[0].text), {
    startHistoryId: "100",
    records: [{
      historyId: "101",
      messagesAdded: [{
        messageId: "message-added",
        threadId: "thread-added",
        labelIds: ["INBOX"],
      }],
      messagesDeleted: [{
        messageId: "message-deleted",
        threadId: "thread-deleted",
        labelIds: [],
      }],
    }],
    nextPageToken: "next-output-page",
    historyId: "102",
  });

  const expiredResult = await runGmailDiscoveryTool(
    "gmail_history_list",
    {
      users: {
        history: {
          list: async () => {
            throw { code: 404, message: "private provider detail" };
          },
        },
      },
    },
    { start_history_id: "100" }
  );
  assert.equal(expiredResult.isError, true);
  assert.deepEqual(JSON.parse(expiredResult.content[0].text), {
    error: { code: 404, category: "not_found" },
  });
  assert.doesNotMatch(expiredResult.content[0].text, /private provider detail/);

  const quotaError = { code: 429, message: "quota exhausted" };
  await assert.rejects(
    runGmailDiscoveryTool(
      "gmail_history_list",
      {
        users: {
          history: {
            list: async () => {
              throw quotaError;
            },
          },
        },
      },
      { start_history_id: "100" }
    ),
    (error) => error === quotaError
  );
  await assert.rejects(
    runGmailDiscoveryTool(
      "gmail_history_list",
      { users: { history: { list: async () => ({ data: {} }) } } },
      { start_history_id: "" }
    ),
    /start_history_id is required/
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
