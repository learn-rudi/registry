#!/usr/bin/env node
/**
 * Google Workspace OAuth Setup
 *
 * Usage:
 *   npx tsx src/auth.ts                    # Auth with default credentials
 *   npx tsx src/auth.ts user@gmail.com     # Auth for specific account
 *
 * Environment:
 *   OAUTH_PORT=3457                        # Custom OAuth callback port (default: 3456)
 */

import { google } from "googleapis";
import { createServer } from "http";
import { parse } from "url";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import * as net from "net";
import open from "open";
import {
  GoogleAccountMismatchError,
  normalizeRequestedGoogleAccount,
} from "./authIdentity.js";
import { persistVerifiedGoogleToken } from "./authTokenBinding.js";
import { ensureIsolatedGoogleAccountDirectory } from "./accountStorage.js";
import { loadGoogleCredentials } from "./oauthCredentials.js";
import {
  getWorkspacePaths,
  migrateLegacyStateIfNeeded,
} from "./state.js";

const WORKSPACE_PATHS = getWorkspacePaths();
migrateLegacyStateIfNeeded(WORKSPACE_PATHS);
const ACCOUNTS_DIR = WORKSPACE_PATHS.accountsDir;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
];

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port);
  });
}

/**
 * Find an available port starting from a base port
 */
async function findAvailablePort(basePort = 3456): Promise<number> {
  for (let port = basePort; port < basePort + 10; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available ports found in range ${basePort}-${basePort + 10}`);
}

async function authenticate(accountEmail?: string) {
  const requestedAccount = accountEmail == null
    ? undefined
    : normalizeRequestedGoogleAccount(accountEmail);

  // Determine account directory
  let accountDir: string;
  let credentialsPath: string;
  let selectedAccount = requestedAccount;

  if (requestedAccount) {
    accountDir = ensureIsolatedGoogleAccountDirectory(ACCOUNTS_DIR, requestedAccount);
    credentialsPath = join(accountDir, "credentials.json");

    if (!existsSync(credentialsPath) && process.env.GOOGLE_CREDENTIALS?.trim()) {
      console.log("Using OAuth credentials from RUDI secret GOOGLE_CREDENTIALS");
    }
  } else {
    // Find first account with credentials
    const accounts = existsSync(ACCOUNTS_DIR)
      ? readdirSync(ACCOUNTS_DIR).filter((f: string) => !f.startsWith("."))
      : [];

    if (accounts.length === 0) {
      console.error(`No accounts found in ${ACCOUNTS_DIR}. Run with email: npx tsx src/auth.ts user@gmail.com`);
      process.exit(1);
    }

    selectedAccount = normalizeRequestedGoogleAccount(accounts[0]);
    accountDir = ensureIsolatedGoogleAccountDirectory(ACCOUNTS_DIR, selectedAccount);
    credentialsPath = join(accountDir, "credentials.json");
    console.log(`Using account: ${selectedAccount}`);
  }

  if (!existsSync(credentialsPath) && !process.env.GOOGLE_CREDENTIALS?.trim()) {
    console.error(`credentials.json not found at ${credentialsPath}`);
    process.exit(1);
  }

  // Find available port (support OAUTH_PORT env var or auto-detect)
  const requestedPort = process.env.OAUTH_PORT ? parseInt(process.env.OAUTH_PORT) : 3456;
  const port = await findAvailablePort(requestedPort);

  if (port !== requestedPort) {
    console.log(`Port ${requestedPort} unavailable, using port ${port} instead`);
  }

  const credentials = loadGoogleCredentials(WORKSPACE_PATHS, selectedAccount);
  if (!credentials) {
    console.error("No OAuth credentials found. Set GOOGLE_CREDENTIALS or add credentials.json to the account state folder.");
    process.exit(1);
  }
  const oauthConfig = credentials.installed || credentials.web;
  if (!oauthConfig?.client_id || !oauthConfig?.client_secret) {
    console.error("OAuth credentials must include installed or web client_id/client_secret.");
    process.exit(1);
  }
  const { client_id, client_secret } = oauthConfig;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    `http://localhost:${port}/callback`
  );

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // Force consent to get refresh token
    login_hint: selectedAccount,
  });

  console.log("\n========================================");
  console.log("Google Workspace OAuth Setup");
  console.log("========================================\n");
  console.log(`Account: ${selectedAccount}`);
  console.log("\nOpening browser for authentication...\n");

  // Start local server to receive callback
  const server = createServer(async (req, res) => {
    const urlParts = parse(req.url || "", true);

    if (urlParts.pathname === "/callback") {
      const code = urlParts.query.code as string;

      if (code) {
        try {
          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.setCredentials(tokens);

          const tokenPath = join(accountDir, "token.json");
          const tokenData = {
            token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_uri: "https://oauth2.googleapis.com/token",
            client_id,
            scopes: SCOPES,
            universe_domain: "googleapis.com",
            expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          };
          const authenticatedAccount = await persistVerifiedGoogleToken({
            requestedAccount: selectedAccount,
            tokenPath,
            tokenData,
            readAuthenticatedAccount: async () => {
              const gmail = google.gmail({ version: "v1", auth: oauth2Client });
              const profile = await gmail.users.getProfile({ userId: "me" });
              return profile.data.emailAddress;
            },
          });

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                  <h1 style="color: #22c55e;">✓ Authentication Successful!</h1>
                  <p>Account: <strong>${authenticatedAccount}</strong></p>
                  <p>You can close this window.</p>
                </div>
              </body>
            </html>
          `);

          console.log("✓ Authentication successful!");
          console.log(`  Verified account: ${authenticatedAccount}`);
          console.log(`  Token saved to: ${tokenPath}`);

          setTimeout(() => {
            server.close();
            process.exit(0);
          }, 1000);

        } catch (error: any) {
          const statusCode = error instanceof GoogleAccountMismatchError ? 400 : 500;
          res.writeHead(statusCode, { "Content-Type": "text/html" });
          res.end(`<h1>Error</h1><p>${error.message}</p>`);
          console.error(
            error instanceof GoogleAccountMismatchError
              ? "Authentication rejected:"
              : "Error getting token:",
            error.message
          );
          setTimeout(() => {
            server.close();
            process.exit(1);
          }, 1000);
        }
      } else {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Error: No code received</h1>");
      }
    }
  });

  server.listen(port, () => {
    console.log(`Waiting for authentication callback on http://localhost:${port}/callback\n`);
    open(authUrl);
  });
}

// Get account email from command line
const accountEmail = process.argv[2];
authenticate(accountEmail);
