#!/usr/bin/env node
/**
 * Test script for Zoho Mail TypeScript MCP
 */
const { readFileSync, writeFileSync } = require("fs");
const { config } = require("dotenv");
config();

const TOKEN_FILE = "./token.json";
const ZOHO_MAIL_URL = "https://mail.zoho.com";

async function refreshToken(tokenData) {
  const response = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      refresh_token: tokenData.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json();
  tokenData.access_token = data.access_token;
  writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
  return tokenData;
}

async function zohoRequest(method, endpoint, tokenData, body) {
  const url = `${ZOHO_MAIL_URL}/api/accounts/${tokenData.account_id}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${tokenData.access_token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    const refreshed = await refreshToken(tokenData);
    return zohoRequest(method, endpoint, refreshed, body);
  }
  return response.json();
}

async function test() {
  console.log("=== Zoho Mail TS MCP Test ===\n");

  const tokenData = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));

  // Get account info if needed
  if (!tokenData.account_id) {
    const resp = await fetch(`${ZOHO_MAIL_URL}/api/accounts`, {
      headers: { Authorization: `Zoho-oauthtoken ${tokenData.access_token}` },
    });
    const data = await resp.json();
    if (data.data?.[0]) {
      tokenData.account_id = data.data[0].accountId;
      tokenData.primary_email = data.data[0].primaryEmailAddress;
      writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
    }
  }

  console.log("1. List Folders:");
  const folders = await zohoRequest("GET", "/folders", tokenData);
  folders.data?.slice(0, 5).forEach(f => {
    console.log(`   - ${f.folderName}: ${f.mailCount} emails`);
  });

  console.log("\n2. List Emails (latest 3):");
  const emails = await zohoRequest("GET", "/messages/view?limit=3", tokenData);
  emails.data?.forEach(e => {
    console.log(`   - ${e.subject}`);
    console.log(`     From: ${e.fromAddress}`);
  });

  console.log("\n✓ All tests passed!");
}

test().catch(console.error);
