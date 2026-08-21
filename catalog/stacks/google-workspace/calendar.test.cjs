#!/usr/bin/env node
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function main() {
  await testCalendarEventBuilder();
  await testCalendarDiscoveryNormalization();
  await testCalendarDiscoveryAdapter();
  await testCalendarCreateExportUsesSharedBuilder();
  await testCalendarToolSchemas();
}

async function testCalendarDiscoveryAdapter() {
  const { runCalendarDiscoveryPage } = await import("./src/calendar-discovery.ts");
  const calls = [];
  const calendar = {
    events: {
      list: async (args) => {
        calls.push(args);
        return {
          data: {
            items: [{
              id: "provider-event",
              start: { dateTime: "2026-01-01T12:00:00Z" },
              organizer: { email: "organizer@example.com" },
            }],
            nextPageToken: "next",
          },
        };
      },
    },
  };
  const gmail = {
    users: {
      getProfile: async () => ({ data: { emailAddress: "owner@example.com" } }),
    },
  };
  const response = await runCalendarDiscoveryPage(calendar, gmail, {
    account: "owner@example.com",
    calendar_id: "team@example.com",
    window_start: "2026-01-01T00:00:00Z",
    window_end: "2026-01-02T00:00:00Z",
    max_results: 500,
    max_records: 500,
    next_page_token: "prior",
  });
  assert.equal(JSON.parse(response.content[0].text).observations[0].address, "organizer@example.com");
  assert.deepEqual(calls[0], {
    calendarId: "team@example.com",
    timeMin: "2026-01-01T00:00:00.000Z",
    timeMax: "2026-01-02T00:00:00.000Z",
    maxResults: 500,
    pageToken: "prior",
    singleEvents: true,
    orderBy: "startTime",
    showDeleted: false,
    fields:
      "items(id,recurringEventId,start,organizer(email,displayName),attendees(email,displayName)),nextPageToken",
  });
  assert.doesNotMatch(
    calls[0].fields,
    /summary|description|location|htmlLink|iCalUID|responseStatus/i
  );
  await assert.rejects(
    runCalendarDiscoveryPage(
      calendar,
      { users: { getProfile: async () => ({ data: { emailAddress: "other@example.com" } }) } },
      {
        account: "owner@example.com",
        calendar_id: "team@example.com",
        window_start: "2026-01-01T00:00:00Z",
        window_end: "2026-01-02T00:00:00Z",
      }
    ),
    /profile does not match account/
  );
}

async function testCalendarDiscoveryNormalization() {
  const { normalizeCalendarDiscoveryPage } = await import("./src/calendar.ts");
  const providerPage = {
    items: [{
      id: "provider-event-id",
      recurringEventId: "provider-series-id",
      iCalUID: "must-not-cross@example.com",
      summary: "must not cross the discovery boundary",
      description: "must not cross the discovery boundary",
      location: "must not cross the discovery boundary",
      htmlLink: "https://calendar.example.invalid/private",
      start: { dateTime: "2026-06-02T15:00:00-04:00" },
      end: { dateTime: "2026-06-02T15:30:00-04:00" },
      organizer: {
        email: "Organizer@Example.com",
        displayName: "Event Organizer",
      },
      attendees: [
        { email: "Guest@Example.com", displayName: "Event Guest", responseStatus: "accepted" },
        { email: "GUEST@Example.com", displayName: "Event Guest", responseStatus: "tentative" },
      ],
    }],
    nextPageToken: "next-calendar-page",
  };
  const scope = {
    account: "owner@example.com",
    calendar_id: "team@example.com",
    window_start: "2026-01-01T00:00:00Z",
    window_end: "2026-08-01T00:00:00Z",
    max_records: 500,
  };
  const page = normalizeCalendarDiscoveryPage(providerPage, scope);

  assert.deepEqual(
    {
      ...page,
      observations: page.observations.map(
        ({ resource_key, recurrence_key, ...observation }) => ({
          resource_key: /^[0-9a-f]{64}$/.test(resource_key),
          recurrence_key: /^[0-9a-f]{64}$/.test(recurrence_key),
          ...observation,
        })
      ),
    },
    {
      source: "calendar",
      account: "owner@example.com",
      calendar_id: "team@example.com",
      window_start: "2026-01-01T00:00:00.000Z",
      window_end: "2026-08-01T00:00:00.000Z",
      observations: [
        {
          resource_key: true,
          recurrence_key: true,
          observed_at: "2026-06-02T19:00:00.000Z",
          address_role: "attendee",
          address: "guest@example.com",
          display_name: "Event Guest",
        },
        {
          resource_key: true,
          recurrence_key: true,
          observed_at: "2026-06-02T19:00:00.000Z",
          address_role: "organizer",
          address: "organizer@example.com",
          display_name: "Event Organizer",
        },
      ],
      next_page_token: "next-calendar-page",
    }
  );
  assert.deepEqual(normalizeCalendarDiscoveryPage(providerPage, scope), page);
  assert.notEqual(
    normalizeCalendarDiscoveryPage(providerPage, {
      ...scope,
      calendar_id: "other@example.com",
    }).observations[0].resource_key,
    page.observations[0].resource_key
  );
  assert.doesNotMatch(
    JSON.stringify(page),
    /provider-event-id|provider-series-id|must.not.cross|summary|description|location|htmlLink|responseStatus/i
  );

  const overlappingPage = normalizeCalendarDiscoveryPage(
    {
      items: [
        {
          id: "overlapping-provider-event",
          start: { dateTime: "2025-12-31T23:00:00Z" },
          end: { dateTime: "2026-01-01T01:00:00Z" },
          organizer: { email: "old@example.com" },
        },
        {
          id: "no-contact-provider-event",
          start: { dateTime: "2026-01-01T12:00:00Z" },
          end: { dateTime: "2026-01-01T13:00:00Z" },
        },
      ],
      nextPageToken: "overlap-next-page",
    },
    {
      account: "owner@example.com",
      calendar_id: "team@example.com",
      window_start: "2026-01-01T00:00:00Z",
      window_end: "2026-01-02T00:00:00Z",
      max_records: 500,
    }
  );
  assert.deepEqual(overlappingPage.observations, []);
  assert.equal(overlappingPage.next_page_token, "overlap-next-page");
}

async function testCalendarEventBuilder() {
  const { buildCalendarEventInsert } = await import("./src/calendar.ts");
  const insert = buildCalendarEventInsert({
    calendar_id: "rudi@learnrudi.com",
    summary: "Elena intro",
    start: "2026-06-02T15:00:00-04:00",
    end: "2026-06-02T15:30:00-04:00",
    time_zone: "America/New_York",
    description: "Discuss setup",
    location: "Google Meet",
    attendees: ["elena@example.com", "brandon@example.com"],
    create_meet: true,
    send_updates: "all",
  });

  assert.equal(insert.calendarId, "rudi@learnrudi.com");
  assert.equal(insert.conferenceDataVersion, 1);
  assert.equal(insert.sendUpdates, "all");
  assert.deepEqual(insert.requestBody.attendees, [
    { email: "elena@example.com" },
    { email: "brandon@example.com" },
  ]);
  assert.equal(insert.requestBody.conferenceData?.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
  assert.match(insert.requestBody.conferenceData?.createRequest.requestId || "", /^rudi-/);
  assert.equal(insert.requestBody.start.timeZone, "America/New_York");
  assert.equal(insert.requestBody.end.timeZone, "America/New_York");
}

async function testCalendarCreateExportUsesSharedBuilder() {
  const source = require("node:fs").readFileSync("./src/index.ts", "utf8");
  const exportStart = source.indexOf("export async function calendarCreate");
  assert(exportStart >= 0, "calendarCreate export must exist");
  const exportBody = source.slice(exportStart, source.indexOf("// Only start MCP", exportStart));
  assert(
    exportBody.includes("buildCalendarEventInsert(options)"),
    "calendarCreate export must use the same event builder as the MCP handler"
  );
  assert(
    exportBody.includes("meetLink"),
    "calendarCreate export must return Meet link metadata when Google provides it"
  );
}

async function testCalendarToolSchemas() {
  const stateDir = mkdtempSync(path.join(tmpdir(), "google-workspace-calendar-tools-"));
  const client = new Client(
    { name: "google-workspace-calendar-test", version: "0.0.0" },
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
    assert(byName.calendar_discovery_page, "calendar_discovery_page must be exposed");
    assert.deepEqual(byName.calendar_discovery_page.inputSchema.required, [
      "account",
      "calendar_id",
      "window_start",
      "window_end",
    ]);
    assert.equal(
      byName.calendar_discovery_page.inputSchema.properties.max_results.maximum,
      500
    );
    assert.equal(
      byName.calendar_discovery_page.inputSchema.properties.max_records.maximum,
      500
    );
    for (const contentField of ["summary", "description", "location", "query"]) {
      assert.equal(
        byName.calendar_discovery_page.inputSchema.properties[contentField],
        undefined
      );
    }
    const createProps = byName.calendar_create.inputSchema.properties;

    for (const field of [
      "calendar_id",
      "account",
      "attendees",
      "create_meet",
      "send_updates",
      "time_zone",
    ]) {
      assert(createProps[field], `calendar_create must expose ${field}`);
    }

    for (const name of ["calendar_list", "calendar_quick_add", "calendar_delete"]) {
      assert(byName[name].inputSchema.properties.calendar_id, `${name} must support calendar_id`);
      assert(byName[name].inputSchema.properties.account, `${name} must support account`);
    }
  } finally {
    await client.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
