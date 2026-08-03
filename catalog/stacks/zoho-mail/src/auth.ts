#!/usr/bin/env node
/**
 * Zoho Mail OAuth setup.
 *
 * Usage:
 *   npm run auth -- --email you@example.com --region us
 *   npx tsx src/auth.ts you@example.com us
 *
 * Required setup:
 *   1. Create a Server-based Application in the Zoho API Console for your data center.
 *   2. Add Authorized Redirect URI: http://localhost:3458/callback
 *   3. Configure ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET with RUDI secrets.
 */

import { createServer } from "http";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import * as net from "net";
import open from "open";

type RegionKey = "us" | "eu" | "in" | "au" | "jp" | "cn" | "ca" | "sa" | "ae";

interface RegionConfig {
  key: RegionKey;
  label: string;
  accountsServer: string;
  apiBase: string;
  apiDomain: string;
  consoleUrl: string;
}

interface Credentials {
  client_id: string;
  client_secret: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  api_domain?: string;
  token_type?: string;
  expires_in?: number;
  expires_in_sec?: number;
  error?: string;
  error_description?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const STACK_DIR = join(__dirname, "..");
const RUDI_HOME = process.env.RUDI_HOME || join(homedir(), ".rudi");
const STACK_STATE_DIR = process.env.ZOHO_MAIL_STATE_DIR || join(RUDI_HOME, "state", "stacks", "zoho-mail");
const ACCOUNTS_DIR = join(STACK_STATE_DIR, "accounts");
const CREDENTIALS_PATH = process.env.ZOHO_MAIL_CREDENTIALS_PATH || join(STACK_STATE_DIR, "credentials.json");
const STATE_PATH = join(STACK_STATE_DIR, "state.json");
const REDIRECT_PATH = "/callback";
const DEFAULT_PORT = 3458;
const REQUEST_TIMEOUT_MS = 20_000;

const SCOPES = [
  "ZohoMail.accounts.READ",
  "ZohoMail.folders.READ",
  "ZohoMail.messages.READ",
  "ZohoMail.messages.CREATE",
  "ZohoMail.messages.UPDATE",
  "ZohoMail.messages.DELETE",
];

const REGIONS: Record<RegionKey, RegionConfig> = {
  us: {
    key: "us",
    label: "United States",
    accountsServer: "https://accounts.zoho.com",
    apiBase: "https://mail.zoho.com/api",
    apiDomain: "https://www.zohoapis.com",
    consoleUrl: "https://api-console.zoho.com",
  },
  eu: {
    key: "eu",
    label: "Europe",
    accountsServer: "https://accounts.zoho.eu",
    apiBase: "https://mail.zoho.eu/api",
    apiDomain: "https://www.zohoapis.eu",
    consoleUrl: "https://api-console.zoho.eu",
  },
  in: {
    key: "in",
    label: "India",
    accountsServer: "https://accounts.zoho.in",
    apiBase: "https://mail.zoho.in/api",
    apiDomain: "https://www.zohoapis.in",
    consoleUrl: "https://api-console.zoho.in",
  },
  au: {
    key: "au",
    label: "Australia",
    accountsServer: "https://accounts.zoho.com.au",
    apiBase: "https://mail.zoho.com.au/api",
    apiDomain: "https://www.zohoapis.com.au",
    consoleUrl: "https://api-console.zoho.com.au",
  },
  jp: {
    key: "jp",
    label: "Japan",
    accountsServer: "https://accounts.zoho.jp",
    apiBase: "https://mail.zoho.jp/api",
    apiDomain: "https://www.zohoapis.jp",
    consoleUrl: "https://api-console.zoho.jp",
  },
  cn: {
    key: "cn",
    label: "China",
    accountsServer: "https://accounts.zoho.com.cn",
    apiBase: "https://mail.zoho.com.cn/api",
    apiDomain: "https://www.zohoapis.com.cn",
    consoleUrl: "https://api-console.zoho.com.cn",
  },
  ca: {
    key: "ca",
    label: "Canada",
    accountsServer: "https://accounts.zohocloud.ca",
    apiBase: "https://mail.zohocloud.ca/api",
    apiDomain: "https://www.zohoapis.ca",
    consoleUrl: "https://api-console.zohocloud.ca",
  },
  sa: {
    key: "sa",
    label: "Saudi Arabia",
    accountsServer: "https://accounts.zoho.sa",
    apiBase: "https://mail.zoho.sa/api",
    apiDomain: "https://www.zohoapis.sa",
    consoleUrl: "https://api-console.zoho.sa",
  },
  ae: {
    key: "ae",
    label: "United Arab Emirates",
    accountsServer: "https://accounts.zoho.ae",
    apiBase: "https://mail.zoho.ae/api",
    apiDomain: "https://www.zohoapis.ae",
    consoleUrl: "https://api-console.zoho.ae",
  },
};

const REGION_ALIASES: Record<string, RegionKey> = {
  ".com": "us",
  com: "us",
  usa: "us",
  us: "us",
  ".eu": "eu",
  eu: "eu",
  europe: "eu",
  ".in": "in",
  in: "in",
  india: "in",
  ".com.au": "au",
  au: "au",
  australia: "au",
  ".jp": "jp",
  jp: "jp",
  japan: "jp",
  ".com.cn": "cn",
  cn: "cn",
  china: "cn",
  ".ca": "ca",
  ca: "ca",
  canada: "ca",
  ".sa": "sa",
  sa: "sa",
  ksa: "sa",
  ".ae": "ae",
  ae: "ae",
  uae: "ae",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function writePrivateJsonFile(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function usage(): never {
  console.error(`
Zoho Mail OAuth setup

Usage:
  npm run auth -- --email you@example.com --region us
  npx tsx src/auth.ts you@example.com us

Required:
  --email   Zoho Mail account email
  --region  us, eu, in, au, jp, cn, ca, sa, or ae

Before running:
  1. Create a Zoho Server-based Application in the matching API Console.
  2. Add redirect URI: http://localhost:${DEFAULT_PORT}${REDIRECT_PATH}
  3. Configure ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET with RUDI secrets.
`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let email = "";
  let regionInput = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--email" || arg === "-e") {
      email = argv[++i] || "";
    } else if (arg === "--region" || arg === "-r") {
      regionInput = argv[++i] || "";
    } else if (!arg.startsWith("-") && !email) {
      email = arg;
    } else if (!arg.startsWith("-") && !regionInput) {
      regionInput = arg;
    }
  }

  if (!email || !regionInput) usage();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Invalid email: ${email}`);
  }

  const regionKey = REGION_ALIASES[regionInput.trim().toLowerCase()];
  if (!regionKey) {
    throw new Error(`Unsupported region '${regionInput}'. Use one of: ${Object.keys(REGIONS).join(", ")}`);
  }

  return { email, region: REGIONS[regionKey] };
}

function readCredentials(): Credentials {
  const envClientId = process.env.ZOHO_CLIENT_ID?.trim();
  const envClientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
  if (envClientId && envClientSecret) {
    return { client_id: envClientId, client_secret: envClientSecret };
  }
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Missing Zoho OAuth credentials. Configure ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET with RUDI secrets, or create ${CREDENTIALS_PATH}.`
    );
  }

  const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
  const credentials = raw.zoho || raw;
  if (
    !credentials ||
    typeof credentials.client_id !== "string" ||
    typeof credentials.client_secret !== "string" ||
    credentials.client_id.trim() === "" ||
    credentials.client_secret.trim() === ""
  ) {
    throw new Error("credentials.json must contain non-empty client_id and client_secret strings.");
  }

  return {
    client_id: credentials.client_id.trim(),
    client_secret: credentials.client_secret.trim(),
  };
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function exchangeCodeForToken(
  accountsServer: string,
  credentials: Credentials,
  code: string,
  redirectUri: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(`${accountsServer}/oauth/v2/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  const data = JSON.parse(text || "{}") as TokenResponse;
  if (!response.ok || data.error || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${response.status}`;
    throw new Error(`Zoho token exchange failed: ${detail}`);
  }
  return data;
}

function regionFromCallback(location: string | undefined, fallback: RegionConfig): RegionConfig {
  if (!location) return fallback;
  const regionKey = REGION_ALIASES[location.trim().toLowerCase()];
  return regionKey ? REGIONS[regionKey] : fallback;
}

async function authenticate() {
  const { email, region } = parseArgs(process.argv.slice(2));
  const credentials = readCredentials();
  const requestedPort = process.env.OAUTH_PORT ? Number(process.env.OAUTH_PORT) : DEFAULT_PORT;
  if (!Number.isInteger(requestedPort) || requestedPort <= 0) {
    throw new Error(`Invalid OAUTH_PORT: ${process.env.OAUTH_PORT}`);
  }
  if (!(await isPortAvailable(requestedPort))) {
    throw new Error(
      `Port ${requestedPort} is already in use. Zoho requires an exact redirect URI; stop the process using the port or add a matching redirect URI and rerun with OAUTH_PORT.`
    );
  }

  mkdirSync(STACK_STATE_DIR, { recursive: true, mode: 0o700 });
  chmodSync(STACK_STATE_DIR, 0o700);
  mkdirSync(ACCOUNTS_DIR, { recursive: true, mode: 0o700 });
  const accountDir = join(ACCOUNTS_DIR, email);
  mkdirSync(accountDir, { recursive: true, mode: 0o700 });
  chmodSync(accountDir, 0o700);

  const redirectUri = `http://localhost:${requestedPort}${REDIRECT_PATH}`;
  const state = randomBytes(24).toString("hex");
  const scope = SCOPES.join(",");
  const authParams = new URLSearchParams({
    response_type: "code",
    client_id: credentials.client_id,
    scope,
    redirect_uri: redirectUri,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  const authUrl = `${region.accountsServer}/oauth/v2/auth?${authParams.toString()}`;

  console.log("");
  console.log("Zoho Mail OAuth setup");
  console.log(`Account: ${email}`);
  console.log(`Region: ${region.label} (${region.key})`);
  console.log(`API Console: ${region.consoleUrl}`);
  console.log(`Redirect URI: ${redirectUri}`);
  console.log("");
  console.log("Opening browser for Zoho authorization...");
  console.log("");

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", redirectUri);
      if (requestUrl.pathname !== REDIRECT_PATH) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const returnedState = requestUrl.searchParams.get("state");
      if (returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>OAuth error</h1><p>State mismatch.</p>");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>OAuth error</h1><p>${escapeHtml(error)}</p>`);
        return;
      }

      const code = requestUrl.searchParams.get("code");
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>OAuth error</h1><p>No authorization code received.</p>");
        return;
      }

      const callbackAccountsServer =
        requestUrl.searchParams.get("accounts-server") ||
        requestUrl.searchParams.get("accounts_server") ||
        region.accountsServer;
      const callbackRegion = regionFromCallback(requestUrl.searchParams.get("location") || undefined, region);
      const token = await exchangeCodeForToken(callbackAccountsServer, credentials, code, redirectUri);
      const expiresIn = Number(token.expires_in || token.expires_in_sec || 3600);
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      const tokenPath = join(accountDir, "token.json");
      const tokenData = {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: expiresAt,
        accounts_server: callbackAccountsServer,
        api_domain: token.api_domain || callbackRegion.apiDomain,
        api_base: callbackRegion.apiBase,
        location: callbackRegion.key,
        scope,
        account: email,
      };
      writePrivateJsonFile(tokenPath, tokenData);

      if (!existsSync(STATE_PATH)) {
        writeFileSync(STATE_PATH, JSON.stringify({ currentAccount: email }, null, 2));
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html>
          <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; min-height: 100vh;">
            <main style="text-align: center;">
              <h1>Authentication successful</h1>
              <p>Zoho Mail account connected: <strong>${escapeHtml(email)}</strong></p>
              <p>You can close this window.</p>
            </main>
          </body>
        </html>
      `);

      console.log("Authentication successful.");
      console.log(`Token saved to: ${tokenPath}`);

      setTimeout(() => {
        server.close(() => process.exit(0));
      }, 500);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<h1>OAuth error</h1><p>${escapeHtml(message)}</p>`);
      console.error(message);
    }
  });

  server.listen(requestedPort, "127.0.0.1", () => {
    open(authUrl).catch((error) => {
      console.error(`Could not open browser automatically: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`Open this URL manually: ${authUrl}`);
    });
  });
}

authenticate().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
