#!/usr/bin/env node
/**
 * Test script for Google Workspace TypeScript MCP
 */
const { google } = require("googleapis");
const { readFileSync } = require("fs");

const TOKEN_FILE = "./token.json";

async function test() {
  console.log("=== Google Workspace TS MCP Test ===\n");

  const tokenData = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));

  const oauth2Client = new google.auth.OAuth2(
    tokenData.client_id,
    tokenData.client_secret
  );
  oauth2Client.setCredentials({
    access_token: tokenData.token,
    refresh_token: tokenData.refresh_token,
    expiry_date: new Date(tokenData.expiry).getTime(),
  });

  // Test Gmail
  console.log("1. Gmail - List recent emails:");
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const messages = await gmail.users.messages.list({
    userId: "me",
    maxResults: 3,
  });
  for (const msg of messages.data.messages || []) {
    const full = await gmail.users.messages.get({ userId: "me", id: msg.id });
    const subject = full.data.payload?.headers?.find(h => h.name === "Subject")?.value;
    console.log(`   - ${subject || "(no subject)"}`);
  }

  // Test Calendar
  console.log("\n2. Calendar - Upcoming events:");
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const events = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    maxResults: 3,
    singleEvents: true,
    orderBy: "startTime",
  });
  (events.data.items || []).forEach(e => {
    const start = e.start?.dateTime || e.start?.date;
    console.log(`   - ${e.summary} (${start})`);
  });

  // Test Drive
  console.log("\n3. Drive - Recent files:");
  const drive = google.drive({ version: "v3", auth: oauth2Client });
  const files = await drive.files.list({
    pageSize: 3,
    fields: "files(id, name, mimeType)",
  });
  (files.data.files || []).forEach(f => {
    console.log(`   - ${f.name}`);
  });

  console.log("\n✓ All tests passed!");
}

test().catch(console.error);
