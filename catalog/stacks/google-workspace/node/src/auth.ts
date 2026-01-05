#!/usr/bin/env node
/**
 * Google Workspace OAuth Setup
 *
 * Usage:
 *   npx tsx src/auth.ts                    # Auth with default credentials
 *   npx tsx src/auth.ts user@gmail.com     # Auth for specific account
 */

import { google } from "googleapis";
import { createServer } from "http";
import { parse } from "url";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import open from "open";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACCOUNTS_DIR = join(__dirname, "..", "accounts");
const DEFAULT_CREDENTIALS = join(__dirname, "..", "accounts", "brandonzhoff@gmail.com", "credentials.json");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar",
];

async function authenticate(accountEmail?: string) {
  // Determine account directory
  let accountDir: string;
  let credentialsPath: string;

  if (accountEmail) {
    accountDir = join(ACCOUNTS_DIR, accountEmail);
    credentialsPath = join(accountDir, "credentials.json");

    // Create account folder if it doesn't exist
    if (!existsSync(accountDir)) {
      console.log(`Creating account folder: ${accountEmail}`);
      mkdirSync(accountDir, { recursive: true });

      // Copy credentials from existing account
      if (existsSync(DEFAULT_CREDENTIALS)) {
        copyFileSync(DEFAULT_CREDENTIALS, credentialsPath);
        console.log(`Copied credentials.json to ${accountDir}`);
      } else {
        console.error("No credentials.json found. Please add one to the account folder.");
        process.exit(1);
      }
    }
  } else {
    // Find first account with credentials
    const accounts = existsSync(ACCOUNTS_DIR)
      ? require("fs").readdirSync(ACCOUNTS_DIR).filter((f: string) => !f.startsWith("."))
      : [];

    if (accounts.length === 0) {
      console.error("No accounts found. Run with email: npx tsx src/auth.ts user@gmail.com");
      process.exit(1);
    }

    accountDir = join(ACCOUNTS_DIR, accounts[0]);
    credentialsPath = join(accountDir, "credentials.json");
    console.log(`Using account: ${accounts[0]}`);
  }

  if (!existsSync(credentialsPath)) {
    console.error(`credentials.json not found at ${credentialsPath}`);
    process.exit(1);
  }

  const credentials = JSON.parse(readFileSync(credentialsPath, "utf-8"));
  const { client_id, client_secret } = credentials.installed || credentials.web;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    "http://localhost:3456/callback"
  );

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // Force consent to get refresh token
  });

  console.log("\n========================================");
  console.log("Google Workspace OAuth Setup");
  console.log("========================================\n");
  console.log(`Account: ${accountEmail || "default"}`);
  console.log("\nOpening browser for authentication...\n");

  // Start local server to receive callback
  const server = createServer(async (req, res) => {
    const urlParts = parse(req.url || "", true);

    if (urlParts.pathname === "/callback") {
      const code = urlParts.query.code as string;

      if (code) {
        try {
          const { tokens } = await oauth2Client.getToken(code);

          // Save token
          const tokenPath = join(accountDir, "token.json");
          const tokenData = {
            token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_uri: "https://oauth2.googleapis.com/token",
            client_id,
            client_secret,
            scopes: SCOPES,
            universe_domain: "googleapis.com",
            account: accountEmail || "",
            expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          };

          writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2));

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                  <h1 style="color: #22c55e;">✓ Authentication Successful!</h1>
                  <p>Account: <strong>${accountEmail || "default"}</strong></p>
                  <p>You can close this window.</p>
                </div>
              </body>
            </html>
          `);

          console.log("✓ Authentication successful!");
          console.log(`  Token saved to: ${tokenPath}`);

          setTimeout(() => {
            server.close();
            process.exit(0);
          }, 1000);

        } catch (error: any) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`<h1>Error</h1><p>${error.message}</p>`);
          console.error("Error getting token:", error.message);
        }
      } else {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Error: No code received</h1>");
      }
    }
  });

  server.listen(3456, () => {
    console.log("Waiting for authentication callback on http://localhost:3456/callback\n");
    open(authUrl);
  });
}

// Get account email from command line
const accountEmail = process.argv[2];
authenticate(accountEmail);
