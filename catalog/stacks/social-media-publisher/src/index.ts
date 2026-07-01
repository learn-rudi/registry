#!/usr/bin/env node
/**
 * Social Media Publisher MCP
 * Post to Twitter, LinkedIn, Facebook, Instagram, and TikTok from one unified interface
 *
 * Usage:
 *   - As MCP: Run without args, speaks JSON-RPC
 *   - As API: import { twitterPost, linkedinPost, ... } from './index'
 *   - As CLI: node index.ts <platform> <command> [options]
 *
 * CLI Examples:
 *   node index.ts twitter post --text "Hello world!"
 *   node index.ts linkedin post --text "Professional update"
 *   node index.ts facebook post --text "Hello" --page "Engineer Marketing"
 *   node index.ts instagram post --image ./photo.jpg --caption "Check this out"
 *   node index.ts tiktok upload --path ./video.mp4
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TwitterApi } from "twitter-api-v2";
import axios from "axios";
import { config } from "dotenv";
import { chmodSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { getPlatformAdapter, listSupportedPlatforms } from "./adapters/index.js";
import { fetchTikTokPublishStatus, queryTikTokCreatorInfo } from "./adapters/tiktok-profile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RUDI_STACK_ENV_PATH = join(homedir(), ".rudi", "secrets", "social-media-publisher.env");
const X_OAUTH2_TOKEN_ENDPOINT = "https://api.x.com/2/oauth2/token";
const LINKEDIN_TOKEN_ENDPOINT = "https://www.linkedin.com/oauth/v2/accessToken";

// Load .env from multiple locations
const envPaths = [
  join(__dirname, "..", ".env"),
  join(__dirname, "..", "..", ".env"),
  RUDI_STACK_ENV_PATH,
  join(homedir(), ".rudi", "secrets", "social-media.env"),
];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath });
  }
}

// Config file paths. Package installs are disposable; local account config lives in RUDI state.
const SOCIAL_MEDIA_BASE =
  process.env.SOCIAL_MEDIA_CONFIG_DIR ||
  join(homedir(), ".rudi", "state", "stacks", "social-media-publisher", "platforms");
const META_CONFIG_PATH = process.env.META_PAGES_CONFIG_PATH || join(SOCIAL_MEDIA_BASE, "meta", "pages-config.json");
const INSTAGRAM_CONFIG_PATH =
  process.env.INSTAGRAM_CONFIG_PATH || join(SOCIAL_MEDIA_BASE, "meta", "instagram", "instagram-config.json");

type ValidationArgs = Record<string, unknown>;
type SocialTarget = {
  asset_type: string;
  platform_asset_id: string;
};

type SocialPost = {
  title?: string;
  body: string;
  metadata: Record<string, unknown>;
};

type DirectPublishArgs = ValidationArgs & {
  confirmPost?: boolean;
  dryRun?: boolean;
  page?: string;
  pageId?: string;
  account?: string;
};

type PublishResult = {
  platformPostId?: string;
  permalinkUrl?: string | null;
  platformResponse?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function envString(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function defaultAssetType(platform: string): string {
  switch (platform) {
    case "facebook":
      return "page";
    case "youtube":
      return "channel";
    case "twitter":
    case "linkedin":
    case "instagram":
    default:
      return "profile";
  }
}

function normalizeValidationInput(args: ValidationArgs): { platform: string; post: SocialPost; target: SocialTarget; media: unknown[] } {
  const platform = optionalString(args.platform)?.trim();
  if (!platform) {
    throw new Error("platform is required");
  }

  const targetInput = asRecord(args.target);
  const metadata = asRecord(args.metadata);
  const media = Array.isArray(args.media) ? args.media.map((item) => asRecord(item)) : [];

  return {
    platform,
    post: {
      title: optionalString(args.title),
      body: String(args.body ?? args.text ?? args.caption ?? args.description ?? ""),
      metadata,
    },
    target: {
      asset_type: optionalString(targetInput.asset_type) || optionalString(args.asset_type) || defaultAssetType(platform),
      platform_asset_id:
        optionalString(targetInput.platform_asset_id) || optionalString(args.platform_asset_id) || "preview",
    },
    media,
  };
}

export function socialListSupportedPlatforms(): string {
  return JSON.stringify({ platforms: listSupportedPlatforms() }, null, 2);
}

export function socialValidatePost(args: ValidationArgs): string {
  const { platform, post, target, media } = normalizeValidationInput(args);
  const adapter = getPlatformAdapter(platform);
  const validation = adapter.validatePost({ post, target, media });

  return JSON.stringify(
    {
      platform,
      target,
      validation,
    },
    null,
    2
  );
}

function isSelfTarget(target: SocialTarget): boolean {
  return ["preview", "self", "me", ""].includes(target.platform_asset_id);
}

function getYouTubeCredential(): string {
  const refreshToken = envString("YOUTUBE_REFRESH_TOKEN");
  if (!refreshToken) {
    throw new Error("YOUTUBE_REFRESH_TOKEN is required for direct YouTube publishing");
  }

  if (!envString("GOOGLE_CLIENT_ID") || !envString("GOOGLE_CLIENT_SECRET")) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for direct YouTube publishing");
  }

  const scopes = envString("YOUTUBE_SCOPES")
    ?.split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  return JSON.stringify({
    refreshToken,
    tokenUri: envString("YOUTUBE_TOKEN_URI"),
    scopes,
  });
}

function dotenvValue(value: string): string {
  return JSON.stringify(value);
}

function persistStackEnvValues(values: Record<string, string | undefined>): void {
  if (!existsSync(RUDI_STACK_ENV_PATH)) {
    return;
  }

  const filtered = Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
  );
  if (Object.keys(filtered).length === 0) {
    return;
  }

  const original = readFileSync(RUDI_STACK_ENV_PATH, "utf8");
  const seen = new Set<string>();
  const lines = original.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match || !(match[1] in filtered)) {
      return line;
    }

    seen.add(match[1]);
    return `${match[1]}=${dotenvValue(filtered[match[1]])}`;
  });

  for (const [key, value] of Object.entries(filtered)) {
    if (!seen.has(key)) {
      lines.push(`${key}=${dotenvValue(value)}`);
    }
  }

  writeFileSync(RUDI_STACK_ENV_PATH, `${lines.filter((line, index) => index < lines.length - 1 || line.length > 0).join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  try {
    chmodSync(RUDI_STACK_ENV_PATH, 0o600);
  } catch {
    // Best-effort permission repair; writeFileSync mode handles newly-created files.
  }
}

async function refreshTwitterOAuth2AccessToken(): Promise<string | undefined> {
  const refreshToken = envString("TWITTER_OAUTH2_REFRESH_TOKEN");
  const clientId = envString("TWITTER_OAUTH2_CLIENT_ID");
  if (!refreshToken || !clientId) {
    return undefined;
  }

  const clientSecret = envString("TWITTER_OAUTH2_CLIENT_SECRET");
  const tokenUri = envString("TWITTER_OAUTH2_TOKEN_URI") || X_OAUTH2_TOKEN_ENDPOINT;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", clientId);
  }

  try {
    const response = await axios.post(tokenUri, body.toString(), { headers });
    const accessToken = optionalString(response.data?.access_token);
    if (!accessToken) {
      throw new Error("X OAuth2 token refresh response did not include access_token");
    }

    const nextRefreshToken = optionalString(response.data?.refresh_token);
    process.env.TWITTER_OAUTH2_ACCESS_TOKEN = accessToken;
    if (nextRefreshToken) {
      process.env.TWITTER_OAUTH2_REFRESH_TOKEN = nextRefreshToken;
    }

    persistStackEnvValues({
      TWITTER_OAUTH2_ACCESS_TOKEN: accessToken,
      TWITTER_OAUTH2_REFRESH_TOKEN: nextRefreshToken,
    });

    return accessToken;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = asRecord(error.response?.data);
      const code = optionalString(data.error) || optionalString(data.title);
      throw new Error(`X OAuth2 token refresh failed${status ? ` (${status})` : ""}${code ? `: ${code}` : ""}`);
    }

    throw error;
  }
}

async function refreshLinkedInAccessToken(): Promise<string | undefined> {
  const refreshToken = envString("LINKEDIN_REFRESH_TOKEN");
  const clientId = envString("LINKEDIN_CLIENT_ID");
  const clientSecret = envString("LINKEDIN_CLIENT_SECRET");
  if (!refreshToken || !clientId || !clientSecret) {
    return undefined;
  }

  const tokenUri = envString("LINKEDIN_TOKEN_URI") || LINKEDIN_TOKEN_ENDPOINT;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const response = await axios.post(tokenUri, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const accessToken = optionalString(response.data?.access_token);
    if (!accessToken) {
      throw new Error("LinkedIn token refresh response did not include access_token");
    }

    const nextRefreshToken = optionalString(response.data?.refresh_token);
    process.env.LINKEDIN_ACCESS_TOKEN = accessToken;
    if (nextRefreshToken) {
      process.env.LINKEDIN_REFRESH_TOKEN = nextRefreshToken;
    }

    persistStackEnvValues({
      LINKEDIN_ACCESS_TOKEN: accessToken,
      LINKEDIN_REFRESH_TOKEN: nextRefreshToken,
    });

    return accessToken;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = asRecord(error.response?.data);
      const code = optionalString(data.error) || optionalString(data.message);
      throw new Error(`LinkedIn token refresh failed${status ? ` (${status})` : ""}${code ? `: ${code}` : ""}`);
    }

    throw error;
  }
}

async function getDirectPublishCredential(
  platform: string,
  target: SocialTarget,
  args: DirectPublishArgs
): Promise<{ token: string; target: SocialTarget; credentialSource: string }> {
  if (platform === "twitter") {
    const refreshedAccessToken = await refreshTwitterOAuth2AccessToken();
    if (refreshedAccessToken) {
      return {
        token: JSON.stringify({ accessToken: refreshedAccessToken, oauthVersion: "2.0" }),
        target,
        credentialSource: "TWITTER_OAUTH2_REFRESH_TOKEN",
      };
    }

    const oauth2AccessToken = envString("TWITTER_OAUTH2_ACCESS_TOKEN");
    if (oauth2AccessToken) {
      return {
        token: JSON.stringify({ accessToken: oauth2AccessToken, oauthVersion: "2.0" }),
        target,
        credentialSource: "TWITTER_OAUTH2_ACCESS_TOKEN",
      };
    }

    const accessToken = envString("TWITTER_ACCESS_TOKEN");
    const accessSecret = envString("TWITTER_ACCESS_SECRET");
    if (accessToken && accessSecret) {
      return {
        token: JSON.stringify({ accessToken, accessSecret }),
        target,
        credentialSource: "TWITTER_ACCESS_TOKEN/TWITTER_ACCESS_SECRET",
      };
    }

    throw new Error("Twitter credentials are not configured");
  }

  if (platform === "linkedin") {
    const refreshedToken = await refreshLinkedInAccessToken();
    const token = refreshedToken || envString("LINKEDIN_ACCESS_TOKEN");
    const credentialSource = refreshedToken ? "LINKEDIN_REFRESH_TOKEN" : "LINKEDIN_ACCESS_TOKEN";
    if (!token) {
      throw new Error("LinkedIn credentials are not configured");
    }

    if (target.asset_type === "profile" && isSelfTarget(target)) {
      const userResponse = await axios.get("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const userId = userResponse.data?.sub;
      if (!userId) {
        throw new Error("LinkedIn userinfo response did not include a profile id");
      }

      return {
        token,
        target: { ...target, platform_asset_id: userId },
        credentialSource,
      };
    }

    return { token, target, credentialSource };
  }

  if (platform === "facebook") {
    const pages = loadFacebookPages();
    const requestedPage = optionalString(args.page);
    const requestedPageId = optionalString(args.pageId) || (isSelfTarget(target) ? undefined : target.platform_asset_id);
    const page =
      (requestedPageId ? pages.find((p) => p.page_id === requestedPageId) : undefined) ||
      (requestedPage ? pages.find((p) => p.name.toLowerCase() === requestedPage.toLowerCase()) : undefined) ||
      pages.find((p) => p.active);

    if (!page) {
      throw new Error("No active Facebook page is configured");
    }

    if (!page.access_token) {
      throw new Error(`Facebook page token is not configured for ${page.name}`);
    }

    return {
      token: page.access_token,
      target: { asset_type: "page", platform_asset_id: page.page_id },
      credentialSource: "Facebook pages config",
    };
  }

  if (platform === "instagram") {
    const accounts = loadInstagramAccounts();
    const requestedAccount = optionalString(args.account)?.replace("@", "");
    const requestedAccountId = isSelfTarget(target) ? undefined : target.platform_asset_id;
    const account =
      (requestedAccountId ? accounts.find((a) => a.instagram_account_id === requestedAccountId) : undefined) ||
      (requestedAccount ? accounts.find((a) => a.instagram_username === requestedAccount) : undefined) ||
      accounts.find((a) => a.active);

    if (!account) {
      throw new Error("No active Instagram account is configured");
    }

    if (!account.access_token) {
      throw new Error(`Instagram account token is not configured for @${account.instagram_username}`);
    }

    return {
      token: account.access_token,
      target: { asset_type: "profile", platform_asset_id: account.instagram_account_id },
      credentialSource: "Instagram accounts config",
    };
  }

  if (platform === "tiktok") {
    return {
      token: getTikTokCredential(),
      target: { asset_type: "profile", platform_asset_id: "self" },
      credentialSource: "TikTok OAuth token",
    };
  }

  if (platform === "youtube") {
    return {
      token: getYouTubeCredential(),
      target: { asset_type: "channel", platform_asset_id: isSelfTarget(target) ? "self" : target.platform_asset_id },
      credentialSource: "YOUTUBE_REFRESH_TOKEN",
    };
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

function platformReadiness(platform: string): Record<string, unknown> {
  const missing: string[] = [];
  const notes: string[] = [];
  let configured = false;
  let targets: unknown[] | undefined;

  try {
    getPlatformAdapter(platform);
  } catch {
    return { platform, supported: false, configured: false, missing: ["supported adapter"] };
  }

  if (platform === "twitter") {
    const hasOauth2 = Boolean(envString("TWITTER_OAUTH2_ACCESS_TOKEN"));
    const hasOauth2Refresh = Boolean(envString("TWITTER_OAUTH2_REFRESH_TOKEN") && envString("TWITTER_OAUTH2_CLIENT_ID"));
    const oauth1Missing = ["TWITTER_API_KEY", "TWITTER_API_SECRET", "TWITTER_ACCESS_TOKEN", "TWITTER_ACCESS_SECRET"].filter(
      (name) => !envString(name)
    );
    configured = hasOauth2Refresh || hasOauth2 || oauth1Missing.length === 0;
    if (!configured) {
      missing.push(
        "TWITTER_OAUTH2_REFRESH_TOKEN/TWITTER_OAUTH2_CLIENT_ID, TWITTER_OAUTH2_ACCESS_TOKEN, or TWITTER_API_KEY/TWITTER_API_SECRET/TWITTER_ACCESS_TOKEN/TWITTER_ACCESS_SECRET"
      );
    }
    if (envString("TWITTER_OAUTH2_REFRESH_TOKEN") && !envString("TWITTER_OAUTH2_CLIENT_ID")) {
      notes.push("TWITTER_OAUTH2_REFRESH_TOKEN is present but TWITTER_OAUTH2_CLIENT_ID is missing; static access token will be used if present.");
    }
    notes.push("OAuth2 refresh-token publishing is preferred for X API v2; app-only bearer tokens are not used for posting.");
  } else if (platform === "linkedin") {
    const hasAccessToken = Boolean(envString("LINKEDIN_ACCESS_TOKEN"));
    const hasRefreshCredential = Boolean(
      envString("LINKEDIN_REFRESH_TOKEN") && envString("LINKEDIN_CLIENT_ID") && envString("LINKEDIN_CLIENT_SECRET")
    );
    configured = hasAccessToken || hasRefreshCredential;
    if (!configured) {
      missing.push("LINKEDIN_ACCESS_TOKEN or LINKEDIN_REFRESH_TOKEN/LINKEDIN_CLIENT_ID/LINKEDIN_CLIENT_SECRET");
    }
    if (envString("LINKEDIN_CLIENT_ID") && envString("LINKEDIN_CLIENT_SECRET") && !configured) {
      notes.push("LinkedIn app credentials are configured; complete 3-legged OAuth to obtain an access token.");
    }
    notes.push("Profile publishing can auto-resolve the member id at publish time; organization publishing needs a target id.");
  } else if (platform === "facebook") {
    try {
      const pages = loadFacebookPages().filter((page) => page.active);
      const pagesWithTokens = pages.filter((page) => Boolean(page.access_token));
      configured = pagesWithTokens.length > 0;
      targets = pages.map((page) => ({
        name: page.name,
        page_id: page.page_id,
        token_configured: Boolean(page.access_token),
      }));
      if (!configured) missing.push("Facebook page access token in pages-config.json");
    } catch {
      missing.push("Facebook pages config");
    }
  } else if (platform === "instagram") {
    try {
      const accounts = loadInstagramAccounts().filter((account) => account.active);
      const accountsWithTokens = accounts.filter((account) => Boolean(account.access_token));
      configured = accountsWithTokens.length > 0;
      targets = accounts.map((account) => ({
        username: account.instagram_username,
        instagram_account_id: account.instagram_account_id,
        token_configured: Boolean(account.access_token),
      }));
      if (!configured) missing.push("Instagram account access token in instagram-config.json");
    } catch {
      missing.push("Instagram accounts config");
    }
    notes.push("Instagram media must be hosted at public HTTPS URLs before publishing.");
  } else if (platform === "tiktok") {
    configured =
      Boolean(envString("TIKTOK_ACCESS_TOKEN")) ||
      Boolean(envString("TIKTOK_REFRESH_TOKEN") && envString("TIKTOK_CLIENT_KEY") && envString("TIKTOK_CLIENT_SECRET"));
    if (!configured) {
      missing.push("TIKTOK_ACCESS_TOKEN or TIKTOK_REFRESH_TOKEN/TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET");
    }
    notes.push("Inbox upload supports local video files; direct post may require app audit or private-account sandbox limits.");
  } else if (platform === "youtube") {
    configured = Boolean(envString("YOUTUBE_REFRESH_TOKEN") && envString("GOOGLE_CLIENT_ID") && envString("GOOGLE_CLIENT_SECRET"));
    if (!envString("YOUTUBE_REFRESH_TOKEN")) missing.push("YOUTUBE_REFRESH_TOKEN");
    if (!envString("GOOGLE_CLIENT_ID")) missing.push("GOOGLE_CLIENT_ID");
    if (!envString("GOOGLE_CLIENT_SECRET")) missing.push("GOOGLE_CLIENT_SECRET");
    notes.push("YouTube videos and thumbnails must be hosted at public HTTPS URLs before direct MCP publishing.");
  }

  return {
    platform,
    supported: true,
    configured,
    missing,
    targets,
    notes,
  };
}

export function socialCheckPublishReady(args: { platform?: string } = {}): string {
  const requestedPlatform = optionalString(args.platform);
  const platforms = requestedPlatform ? [requestedPlatform] : listSupportedPlatforms();

  return JSON.stringify(
    {
      platforms: platforms.map((platform) => platformReadiness(platform)),
    },
    null,
    2
  );
}

export async function socialPublishDirect(args: DirectPublishArgs): Promise<string> {
  const { platform, post, target, media } = normalizeValidationInput(args);
  const adapter = getPlatformAdapter(platform) as any;
  const validation = adapter.validatePost({ post, target, media });

  if (args.dryRun) {
    return JSON.stringify(
      {
        dryRun: true,
        platform,
        target,
        validation,
        note: "Live publishing requires confirmPost=true.",
      },
      null,
      2
    );
  }

  if (!validation.ok) {
    throw new Error(validation.errors[0]?.message ?? "Post payload is invalid");
  }

  if (args.confirmPost !== true) {
    throw new Error("confirmPost must be true for live direct publishing");
  }

  const credential = await getDirectPublishCredential(platform, target, args);
  const result = (await adapter.publish({
    post,
    target: credential.target,
    media,
    token: credential.token,
  })) as PublishResult;

  return JSON.stringify(
    {
      platform,
      target: credential.target,
      mode: validation.mode,
      status: "published",
      platformPostId: result.platformPostId,
      permalinkUrl: result.permalinkUrl,
      platformResponse: result.platformResponse,
    },
    null,
    2
  );
}

// =============================================================================
// TWITTER
// =============================================================================

function getTwitterClient(): TwitterApi {
  const client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY!,
    appSecret: process.env.TWITTER_API_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_SECRET!,
  });
  return client;
}

export async function twitterPost(
  text: string,
  options: { images?: string[]; dryRun?: boolean } = {}
): Promise<string> {
  if (text.length > 280) {
    throw new Error(`Tweet exceeds 280 characters (${text.length} chars)`);
  }

  if (options.dryRun) {
    return `**DRY RUN - Twitter Post**\n\nText: ${text}\n(${text.length} characters)${options.images ? `\nImages: ${options.images.length}` : ""}`;
  }

  const client = getTwitterClient();

  let mediaIds: string[] = [];
  if (options.images && options.images.length > 0) {
    // Upload images
    for (const imagePath of options.images.slice(0, 4)) {
      const mediaId = await client.v1.uploadMedia(imagePath);
      mediaIds.push(mediaId);
    }
  }

  const tweetData: any = { text };
  if (mediaIds.length > 0) {
    tweetData.media = { media_ids: mediaIds };
  }

  const response = await client.v2.tweet(tweetData);
  const tweetId = response.data.id;
  const tweetUrl = `https://twitter.com/i/web/status/${tweetId}`;

  return `**Tweet Posted**\n\n**Text:** ${text}\n**URL:** ${tweetUrl}`;
}

export async function twitterThread(
  tweets: string[],
  options: { dryRun?: boolean } = {}
): Promise<string> {
  // Validate all tweets
  for (let i = 0; i < tweets.length; i++) {
    if (tweets[i].length > 280) {
      throw new Error(`Tweet ${i + 1} exceeds 280 characters (${tweets[i].length} chars)`);
    }
  }

  if (options.dryRun) {
    let preview = `**DRY RUN - Twitter Thread (${tweets.length} tweets)**\n\n`;
    tweets.forEach((t, i) => {
      preview += `**${i + 1}.** ${t}\n(${t.length} chars)\n\n`;
    });
    return preview;
  }

  const client = getTwitterClient();
  const postedTweets: { id: string; url: string }[] = [];

  let replyToId: string | undefined;

  for (let i = 0; i < tweets.length; i++) {
    const tweetData: any = { text: tweets[i] };
    if (replyToId) {
      tweetData.reply = { in_reply_to_tweet_id: replyToId };
    }

    const response = await client.v2.tweet(tweetData);
    const tweetId = response.data.id;
    postedTweets.push({
      id: tweetId,
      url: `https://twitter.com/i/web/status/${tweetId}`,
    });
    replyToId = tweetId;

    // Rate limit protection
    if (i < tweets.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  let result = `**Thread Posted (${tweets.length} tweets)**\n\n`;
  postedTweets.forEach((t, i) => {
    result += `**${i + 1}.** ${t.url}\n`;
  });
  return result;
}

// =============================================================================
// LINKEDIN
// =============================================================================

export async function linkedinPost(
  text: string,
  options: { dryRun?: boolean } = {}
): Promise<string> {
  if (text.length > 3000) {
    throw new Error(`LinkedIn post exceeds 3000 characters (${text.length} chars)`);
  }

  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("LINKEDIN_ACCESS_TOKEN not configured");
  }

  if (options.dryRun) {
    return `**DRY RUN - LinkedIn Post**\n\nText: ${text}\n(${text.length} characters)`;
  }

  // Get user ID via OpenID Connect
  const userResponse = await axios.get("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userId = userResponse.data.sub;

  // Post
  const postData = {
    author: `urn:li:person:${userId}`,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "NONE",
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const response = await axios.post("https://api.linkedin.com/v2/ugcPosts", postData, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });

  const postId = response.data.id;

  return `**LinkedIn Post Published**\n\n**Text:** ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}\n**Post ID:** ${postId}\n**View:** https://www.linkedin.com/feed/`;
}

// =============================================================================
// FACEBOOK
// =============================================================================

interface FacebookPage {
  name: string;
  page_id: string;
  access_token: string;
  active: boolean;
}

function loadFacebookPages(): FacebookPage[] {
  if (!existsSync(META_CONFIG_PATH)) {
    throw new Error(`Facebook config not found at ${META_CONFIG_PATH}`);
  }
  const config = JSON.parse(readFileSync(META_CONFIG_PATH, "utf8"));
  return config.pages || [];
}

export async function facebookListPages(): Promise<string> {
  const pages = loadFacebookPages();
  const activePages = pages.filter((p) => p.active);

  let result = `**Facebook Pages (${activePages.length} active)**\n\n`;
  activePages.forEach((p) => {
    result += `- **${p.name}** (ID: ${p.page_id})\n`;
  });
  return result;
}

export async function facebookPost(
  text: string,
  options: { page?: string; pageId?: string; dryRun?: boolean } = {}
): Promise<string> {
  const pages = loadFacebookPages();

  // Find the page
  let page: FacebookPage | undefined;
  if (options.pageId) {
    page = pages.find((p) => p.page_id === options.pageId);
  } else if (options.page) {
    page = pages.find((p) => p.name.toLowerCase() === options.page!.toLowerCase());
  } else {
    page = pages.find((p) => p.active); // First active page
  }

  if (!page) {
    const available = pages
      .filter((p) => p.active)
      .map((p) => p.name)
      .join(", ");
    throw new Error(`Page not found. Available: ${available}`);
  }

  if (options.dryRun) {
    return `**DRY RUN - Facebook Post**\n\n**Page:** ${page.name}\n**Text:** ${text}`;
  }

  const response = await axios.post(`https://graph.facebook.com/v24.0/${page.page_id}/feed`, {
    message: text,
    access_token: page.access_token,
  });

  const postId = response.data.id;

  return `**Facebook Post Published**\n\n**Page:** ${page.name}\n**Text:** ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}\n**Post ID:** ${postId}\n**View:** https://www.facebook.com/${postId}`;
}

// =============================================================================
// INSTAGRAM
// =============================================================================

interface InstagramAccount {
  facebook_page_name: string;
  instagram_username: string;
  instagram_account_id: string;
  access_token: string;
  active: boolean;
}

function loadInstagramAccounts(): InstagramAccount[] {
  if (!existsSync(INSTAGRAM_CONFIG_PATH)) {
    throw new Error(`Instagram config not found at ${INSTAGRAM_CONFIG_PATH}`);
  }
  const config = JSON.parse(readFileSync(INSTAGRAM_CONFIG_PATH, "utf8"));
  return config.accounts || [];
}

export async function instagramListAccounts(): Promise<string> {
  const accounts = loadInstagramAccounts();
  const activeAccounts = accounts.filter((a) => a.active);

  let result = `**Instagram Accounts (${activeAccounts.length} active)**\n\n`;
  activeAccounts.forEach((a) => {
    result += `- **@${a.instagram_username}** (${a.facebook_page_name})\n`;
  });
  return result;
}

export async function instagramPost(
  imageUrl: string,
  caption: string,
  options: { account?: string; dryRun?: boolean } = {}
): Promise<string> {
  const accounts = loadInstagramAccounts();

  // Find the account
  let account: InstagramAccount | undefined;
  if (options.account) {
    const username = options.account.replace("@", "");
    account = accounts.find((a) => a.instagram_username === username);
  } else {
    account = accounts.find((a) => a.active); // First active account
  }

  if (!account) {
    const available = accounts
      .filter((a) => a.active)
      .map((a) => `@${a.instagram_username}`)
      .join(", ");
    throw new Error(`Account not found. Available: ${available}`);
  }

  // Validate image URL is HTTPS
  if (!imageUrl.startsWith("https://")) {
    throw new Error("Instagram requires a publicly accessible HTTPS image URL");
  }

  if (options.dryRun) {
    return `**DRY RUN - Instagram Post**\n\n**Account:** @${account.instagram_username}\n**Image:** ${imageUrl}\n**Caption:** ${caption}`;
  }

  // Step 1: Create media container
  const containerResponse = await axios.post(
    `https://graph.facebook.com/v24.0/${account.instagram_account_id}/media`,
    {
      image_url: imageUrl,
      caption: caption,
      access_token: account.access_token,
    }
  );
  const creationId = containerResponse.data.id;

  // Step 2: Publish
  const publishResponse = await axios.post(
    `https://graph.facebook.com/v24.0/${account.instagram_account_id}/media_publish`,
    {
      creation_id: creationId,
      access_token: account.access_token,
    }
  );

  const mediaId = publishResponse.data.id;

  return `**Instagram Post Published**\n\n**Account:** @${account.instagram_username}\n**Caption:** ${caption.slice(0, 100)}${caption.length > 100 ? "..." : ""}\n**Media ID:** ${mediaId}`;
}

export async function instagramReelCreateContainer(
  options: {
    videoUrl?: string;
    caption?: string;
    mimeType?: string;
    coverUrl?: string;
    thumbOffset?: number;
    shareToFeed?: boolean;
    account?: string;
    confirmCreate?: boolean;
    dryRun?: boolean;
  } = {}
): Promise<string> {
  const videoUrl = optionalString(options.videoUrl);
  if (!videoUrl) {
    throw new Error("videoUrl is required");
  }

  const post = {
    body: options.caption ?? "",
    metadata: {
      instagram: {
        media_type: "reels",
        cover_url: options.coverUrl,
        thumb_offset: options.thumbOffset,
        share_to_feed: options.shareToFeed,
      },
    },
  };
  const media = [
    {
      media_kind: "video",
      source_url: videoUrl,
      mime_type: options.mimeType,
    },
  ];
  const dryRunTarget = { asset_type: "profile", platform_asset_id: "preview" };
  const adapter = getPlatformAdapter("instagram") as any;
  const validation = adapter.validatePost({ post, target: dryRunTarget, media });

  if (options.dryRun) {
    return JSON.stringify(
      {
        dryRun: true,
        platform: "instagram",
        action: "create_reel_container",
        target: dryRunTarget,
        validation,
        note: "Live container creation requires confirmCreate=true. Use instagram_container_status before instagram_publish_container.",
      },
      null,
      2
    );
  }

  if (!validation.ok) {
    throw new Error(validation.errors[0]?.message ?? "Instagram Reel container payload is invalid");
  }

  if (options.confirmCreate !== true) {
    throw new Error("confirmCreate must be true for live Instagram Reel container creation");
  }

  const target: SocialTarget = { asset_type: "profile", platform_asset_id: "self" };
  const credential = await getDirectPublishCredential("instagram", target, { account: options.account });
  const result = await adapter.createReelContainer({
    post,
    target: credential.target,
    media,
    token: credential.token,
  });

  return JSON.stringify(
    {
      platform: "instagram",
      action: "create_reel_container",
      status: "container_created",
      target: credential.target,
      platformContainerId: result.platformContainerId,
      containerIds: result.containerIds,
      platformResponse: result.platformResponse,
      next: "Call instagram_container_status until status_code is FINISHED, then call instagram_publish_container.",
    },
    null,
    2
  );
}

export async function instagramContainerStatus(
  options: {
    containerId?: string;
    account?: string;
  } = {}
): Promise<string> {
  const containerId = optionalString(options.containerId);
  if (!containerId) {
    throw new Error("containerId is required");
  }

  const target: SocialTarget = { asset_type: "profile", platform_asset_id: "self" };
  const credential = await getDirectPublishCredential("instagram", target, { account: options.account });
  const adapter = getPlatformAdapter("instagram") as any;
  const result = await adapter.getContainerStatus({
    platformContainerId: containerId,
    token: credential.token,
  });

  return JSON.stringify(
    {
      platform: "instagram",
      action: "container_status",
      target: credential.target,
      platformContainerId: result.platformContainerId,
      platformResponse: result.platformResponse,
    },
    null,
    2
  );
}

export async function instagramPublishContainer(
  options: {
    containerId?: string;
    account?: string;
    confirmPost?: boolean;
  } = {}
): Promise<string> {
  const containerId = optionalString(options.containerId);
  if (!containerId) {
    throw new Error("containerId is required");
  }

  if (options.confirmPost !== true) {
    throw new Error("confirmPost must be true for live Instagram container publishing");
  }

  const target: SocialTarget = { asset_type: "profile", platform_asset_id: "self" };
  const credential = await getDirectPublishCredential("instagram", target, { account: options.account });
  const adapter = getPlatformAdapter("instagram") as any;
  const result = await adapter.publishContainer({
    target: credential.target,
    platformContainerId: containerId,
    token: credential.token,
  });

  return JSON.stringify(
    {
      platform: "instagram",
      action: "publish_container",
      status: "published",
      target: credential.target,
      platformPostId: result.platformPostId,
      permalinkUrl: result.permalinkUrl,
      platformResponse: result.platformResponse,
    },
    null,
    2
  );
}

// =============================================================================
// TIKTOK
// =============================================================================

function getTikTokCredential(): string {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
  if (accessToken) {
    return accessToken;
  }

  const refreshToken = process.env.TIKTOK_REFRESH_TOKEN;
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (refreshToken && clientKey && clientSecret) {
    return JSON.stringify({
      refreshToken,
      clientKey,
      clientSecret,
    });
  }

  throw new Error(
    "TikTok credentials not configured. Set TIKTOK_ACCESS_TOKEN, or set TIKTOK_REFRESH_TOKEN with TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET."
  );
}

export async function tiktokVideoUpload(
  options: {
    videoPath?: string;
    videoUrl?: string;
    mimeType?: string;
    caption?: string;
    dryRun?: boolean;
  } = {}
): Promise<string> {
  const videoPath = optionalString(options.videoPath);
  const videoUrl = optionalString(options.videoUrl);

  if (!videoPath && !videoUrl) {
    throw new Error("videoPath or videoUrl is required");
  }

  if (videoPath && videoUrl) {
    throw new Error("Use either videoPath or videoUrl, not both");
  }

  const media = [
    videoPath
      ? {
          media_kind: "video",
          source_path: videoPath,
          mime_type: options.mimeType,
        }
      : {
          media_kind: "video",
          source_url: videoUrl,
          mime_type: options.mimeType,
        },
  ];
  const post = {
    body: options.caption ?? "",
    metadata: {},
  };
  const target = {
    asset_type: "profile",
    platform_asset_id: "self",
  };
  const adapter = getPlatformAdapter("tiktok") as any;
  const validation = adapter.validatePost({ post, target, media });

  if (!validation.ok) {
    throw new Error(validation.errors[0]?.message ?? "TikTok upload payload is invalid");
  }

  if (options.dryRun) {
    return [
      "**DRY RUN - TikTok Inbox Video Upload**",
      "",
      `Mode: ${validation.mode}`,
      videoPath ? `Video path: ${videoPath}` : `Video URL: ${videoUrl}`,
      options.caption ? "Caption note: TikTok video.upload does not set captions; finish captioning in TikTok." : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const result = (await adapter.publish({
    post,
    target,
    media,
    token: getTikTokCredential(),
  })) as {
    platformPostId: string;
    platformResponse: Record<string, unknown>;
  };

  return [
    "**TikTok Video Uploaded To Inbox**",
    "",
    `Publish ID: ${result.platformPostId}`,
    `Transfer method: ${String(result.platformResponse.transfer_method ?? "unknown")}`,
    "Next step: open the TikTok inbox notification to finish editing, captioning, and posting.",
  ].join("\n");
}

export async function tiktokCreatorInfo(): Promise<string> {
  const info = await queryTikTokCreatorInfo({
    accessToken: getTikTokCredential(),
  });

  return JSON.stringify(info, null, 2);
}

export async function tiktokDirectPost(
  options: {
    videoPath?: string;
    videoUrl?: string;
    mimeType?: string;
    caption?: string;
    privacyLevel?: string;
    disableComment?: boolean;
    disableDuet?: boolean;
    disableStitch?: boolean;
    videoCoverTimestampMs?: number;
    brandContentToggle?: boolean;
    brandOrganicToggle?: boolean;
    isAigc?: boolean;
    confirmPost?: boolean;
    dryRun?: boolean;
  } = {}
): Promise<string> {
  const videoPath = optionalString(options.videoPath);
  const videoUrl = optionalString(options.videoUrl);
  const caption = options.caption ?? "";
  const privacyLevel = options.privacyLevel ?? "SELF_ONLY";

  if (!videoPath && !videoUrl) {
    throw new Error("videoPath or videoUrl is required");
  }

  if (videoPath && videoUrl) {
    throw new Error("Use either videoPath or videoUrl, not both");
  }

  if (!options.dryRun && options.confirmPost !== true) {
    throw new Error("confirmPost must be true for live TikTok direct posts");
  }

  const media = [
    videoPath
      ? {
          media_kind: "video",
          source_path: videoPath,
          mime_type: options.mimeType,
        }
      : {
          media_kind: "video",
          source_url: videoUrl,
          mime_type: options.mimeType,
        },
  ];
  const post = {
    body: caption,
    metadata: {
      tiktok: {
        privacyLevel,
        disableComment: options.disableComment,
        disableDuet: options.disableDuet,
        disableStitch: options.disableStitch,
        videoCoverTimestampMs: options.videoCoverTimestampMs,
        brandContentToggle: options.brandContentToggle,
        brandOrganicToggle: options.brandOrganicToggle,
        isAigc: options.isAigc,
      },
    },
  };
  const target = {
    asset_type: "profile",
    platform_asset_id: "self",
  };
  const adapter = getPlatformAdapter("tiktok") as any;
  const validation = adapter.validateDirectPost({ post, target, media });

  if (!validation.ok) {
    throw new Error(validation.errors[0]?.message ?? "TikTok direct post payload is invalid");
  }

  if (options.dryRun) {
    return [
      "**DRY RUN - TikTok Direct Post**",
      "",
      `Mode: ${validation.mode}`,
      `Privacy: ${privacyLevel}`,
      videoPath ? `Video path: ${videoPath}` : `Video URL: ${videoUrl}`,
      caption ? `Caption length: ${caption.length}` : "Caption length: 0",
      "Live posting requires confirmPost=true.",
    ].join("\n");
  }

  const result = (await adapter.directPost({
    post,
    target,
    media,
    token: getTikTokCredential(),
    options: {
      privacyLevel,
      disableComment: options.disableComment,
      disableDuet: options.disableDuet,
      disableStitch: options.disableStitch,
      videoCoverTimestampMs: options.videoCoverTimestampMs,
      brandContentToggle: options.brandContentToggle,
      brandOrganicToggle: options.brandOrganicToggle,
      isAigc: options.isAigc,
    },
  })) as {
    platformPostId: string;
    platformResponse: Record<string, unknown>;
  };

  return [
    "**TikTok Direct Post Submitted**",
    "",
    `Publish ID: ${result.platformPostId}`,
    `Transfer method: ${String(result.platformResponse.transfer_method ?? "unknown")}`,
    `Privacy: ${String(result.platformResponse.privacy_level ?? privacyLevel)}`,
    "Status may remain processing briefly; use tiktok_fetch_status with the publish ID.",
  ].join("\n");
}

export async function tiktokFetchStatus(publishId: string): Promise<string> {
  const status = await fetchTikTokPublishStatus({
    accessToken: getTikTokCredential(),
    publishId,
  });

  return JSON.stringify(status, null, 2);
}

// =============================================================================
// YOUTUBE
// =============================================================================

export async function youtubeVideoUpload(
  options: {
    title?: string;
    description?: string;
    videoUrl?: string;
    thumbnailUrl?: string;
    mimeType?: string;
    thumbnailMimeType?: string;
    privacy?: string;
    tags?: string[] | string;
    categoryId?: string;
    madeForKids?: boolean;
    publishAt?: string;
    dryRun?: boolean;
    confirmPost?: boolean;
  } = {}
): Promise<string> {
  const videoUrl = optionalString(options.videoUrl);
  if (!videoUrl) {
    throw new Error("videoUrl is required");
  }

  const media = [
    {
      media_kind: "video",
      source_url: videoUrl,
      mime_type: options.mimeType,
    },
  ];
  if (options.thumbnailUrl) {
    media.push({
      media_kind: "image",
      source_url: options.thumbnailUrl,
      mime_type: options.thumbnailMimeType,
    });
  }

  const post = {
    title: options.title,
    body: options.description ?? "",
    metadata: {
      youtube: {
        title: options.title,
        description: options.description,
        privacy: options.privacy ?? "private",
        tags: options.tags,
        categoryId: options.categoryId,
        made_for_kids: options.madeForKids,
        publishAt: options.publishAt,
      },
    },
  };
  const target = {
    asset_type: "channel",
    platform_asset_id: "self",
  };
  const adapter = getPlatformAdapter("youtube") as any;
  const validation = adapter.validatePost({ post, target, media });

  if (options.dryRun) {
    return JSON.stringify(
      {
        dryRun: true,
        platform: "youtube",
        target,
        validation,
        note: "Live YouTube upload requires confirmPost=true and hosted HTTPS video media.",
      },
      null,
      2
    );
  }

  if (!validation.ok) {
    throw new Error(validation.errors[0]?.message ?? "YouTube upload payload is invalid");
  }

  if (options.confirmPost !== true) {
    throw new Error("confirmPost must be true for live YouTube uploads");
  }

  const result = (await adapter.publish({
    post,
    target,
    media,
    token: getYouTubeCredential(),
  })) as PublishResult;

  return JSON.stringify(
    {
      platform: "youtube",
      target,
      mode: validation.mode,
      status: "published",
      platformPostId: result.platformPostId,
      permalinkUrl: result.permalinkUrl,
      platformResponse: result.platformResponse,
    },
    null,
    2
  );
}

// =============================================================================
// MCP SERVER
// =============================================================================

const server = new Server({ name: "social-media-publisher", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "social_list_supported_platforms",
      description: "List social platforms supported by the unified publisher core",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "social_validate_post",
      description: "Validate a post against a platform's publisher rules without publishing",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["twitter", "linkedin", "facebook", "instagram", "tiktok", "youtube"],
            description: "Destination platform",
          },
          body: { type: "string", description: "Post body, caption, or video description" },
          title: { type: "string", description: "Optional post title, required by some platforms such as YouTube" },
          target: {
            type: "object",
            description: "Optional destination asset override",
            properties: {
              asset_type: { type: "string", description: "Target asset type, such as profile, page, or channel" },
              platform_asset_id: { type: "string", description: "Platform-specific asset ID" },
            },
          },
          media: {
            type: "array",
            description: "Optional media items to validate",
            items: {
              type: "object",
              properties: {
                media_kind: { type: "string", enum: ["image", "video"], description: "Media kind" },
                source_url: { type: "string", description: "Public HTTPS URL for the media" },
                mime_type: { type: "string", description: "Media MIME type" },
                bytes: { type: "number", description: "Media size in bytes" },
                width: { type: "number", description: "Image or video width in pixels" },
                height: { type: "number", description: "Image or video height in pixels" },
              },
            },
          },
          metadata: {
            type: "object",
            description: "Platform-specific options, keyed by platform name",
          },
        },
        required: ["platform"],
      },
    },
    {
      name: "social_check_publish_ready",
      description: "Report which supported platforms have local credentials/config needed for direct publishing",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["twitter", "linkedin", "facebook", "instagram", "tiktok", "youtube"],
            description: "Optional single platform to check",
          },
        },
      },
    },
    {
      name: "social_publish_direct",
      description:
        "Publish through the unified adapter layer. Requires confirmPost=true for live publishing; use dryRun=true first.",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["twitter", "linkedin", "facebook", "instagram", "tiktok", "youtube"],
            description: "Destination platform",
          },
          body: { type: "string", description: "Post body, caption, or video description" },
          title: { type: "string", description: "Optional post title, required by YouTube and some media flows" },
          target: {
            type: "object",
            description: "Optional destination asset override",
            properties: {
              asset_type: { type: "string", description: "Target asset type, such as profile, page, organization, or channel" },
              platform_asset_id: { type: "string", description: "Platform-specific asset ID" },
            },
          },
          media: {
            type: "array",
            description: "Media items. Most non-TikTok platforms require public HTTPS source_url values.",
            items: {
              type: "object",
              properties: {
                media_kind: { type: "string", enum: ["image", "video"], description: "Media kind" },
                source_url: { type: "string", description: "Public HTTPS URL for the media" },
                source_path: { type: "string", description: "Local file path; currently supported by TikTok upload/direct flows" },
                mime_type: { type: "string", description: "Media MIME type" },
                bytes: { type: "number", description: "Media size in bytes" },
                width: { type: "number", description: "Image or video width in pixels" },
                height: { type: "number", description: "Image or video height in pixels" },
              },
            },
          },
          metadata: {
            type: "object",
            description: "Platform-specific options, keyed by platform name",
          },
          page: { type: "string", description: "Facebook page name override" },
          pageId: { type: "string", description: "Facebook page id override" },
          account: { type: "string", description: "Instagram username override" },
          confirmPost: { type: "boolean", description: "Must be true for live publishing" },
          dryRun: { type: "boolean", description: "Validate and preview without publishing" },
        },
        required: ["platform"],
      },
    },
    {
      name: "twitter_post",
      description: "Post a tweet to Twitter (max 280 chars). Can include up to 4 images.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Tweet text (max 280 characters)" },
          images: {
            type: "array",
            items: { type: "string" },
            description: "Optional array of image file paths (max 4)",
          },
          dryRun: { type: "boolean", description: "Preview without posting" },
        },
        required: ["text"],
      },
    },
    {
      name: "twitter_thread",
      description: "Post a multi-tweet thread to Twitter",
      inputSchema: {
        type: "object",
        properties: {
          tweets: {
            type: "array",
            items: { type: "string" },
            description: "Array of tweet texts (each max 280 chars)",
          },
          dryRun: { type: "boolean", description: "Preview without posting" },
        },
        required: ["tweets"],
      },
    },
    {
      name: "linkedin_post",
      description: "Post an update to LinkedIn (max 3000 chars)",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Post text (max 3000 characters)" },
          dryRun: { type: "boolean", description: "Preview without posting" },
        },
        required: ["text"],
      },
    },
    {
      name: "facebook_post",
      description: "Post to a Facebook Page. Use facebook_list_pages to see available pages.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Post text" },
          page: { type: "string", description: "Page name (e.g., 'Engineer Marketing')" },
          pageId: { type: "string", description: "Page ID (alternative to page name)" },
          dryRun: { type: "boolean", description: "Preview without posting" },
        },
        required: ["text"],
      },
    },
    {
      name: "facebook_list_pages",
      description: "List all available Facebook Pages",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "instagram_post",
      description:
        "Post an image to Instagram. Requires a publicly accessible HTTPS image URL. Use instagram_list_accounts to see available accounts.",
      inputSchema: {
        type: "object",
        properties: {
          imageUrl: { type: "string", description: "Public HTTPS URL of the image" },
          caption: { type: "string", description: "Post caption" },
          account: { type: "string", description: "Instagram username (e.g., '@engineermarketing')" },
          dryRun: { type: "boolean", description: "Preview without posting" },
        },
        required: ["imageUrl", "caption"],
      },
    },
    {
      name: "instagram_reel_create_container",
      description:
        "Create an Instagram Reel media container from a hosted HTTPS video without publishing it. Requires confirmCreate=true for live container creation.",
      inputSchema: {
        type: "object",
        properties: {
          videoUrl: { type: "string", description: "Public HTTPS URL of the Reel video" },
          caption: { type: "string", description: "Reel caption" },
          mimeType: { type: "string", description: "Optional video MIME type" },
          coverUrl: { type: "string", description: "Optional public HTTPS cover image URL" },
          thumbOffset: { type: "number", description: "Optional cover frame timestamp offset" },
          shareToFeed: { type: "boolean", description: "Whether to share the Reel to feed; defaults to true" },
          account: { type: "string", description: "Instagram username (e.g., '@engineermarketing')" },
          confirmCreate: { type: "boolean", description: "Must be true for live container creation" },
          dryRun: { type: "boolean", description: "Validate and preview without creating a container" },
        },
        required: ["videoUrl"],
      },
    },
    {
      name: "instagram_container_status",
      description: "Check an Instagram media container status by container id without creating or publishing media.",
      inputSchema: {
        type: "object",
        properties: {
          containerId: { type: "string", description: "Instagram media container id returned by instagram_reel_create_container" },
          account: { type: "string", description: "Instagram username (e.g., '@engineermarketing')" },
        },
        required: ["containerId"],
      },
    },
    {
      name: "instagram_publish_container",
      description: "Publish an existing Instagram media container after its status_code is FINISHED. Requires confirmPost=true.",
      inputSchema: {
        type: "object",
        properties: {
          containerId: { type: "string", description: "Instagram media container id to publish" },
          account: { type: "string", description: "Instagram username (e.g., '@engineermarketing')" },
          confirmPost: { type: "boolean", description: "Must be true for live publishing" },
        },
        required: ["containerId"],
      },
    },
    {
      name: "instagram_list_accounts",
      description: "List all available Instagram accounts",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "tiktok_creator_info",
      description: "Fetch TikTok Direct Post creator settings, including privacy_level_options and interaction limits",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "tiktok_direct_post",
      description:
        "Directly post a video to TikTok using Content Posting API video.publish. Requires confirmPost=true for live posting.",
      inputSchema: {
        type: "object",
        properties: {
          videoPath: { type: "string", description: "Local video file path to direct post with FILE_UPLOAD" },
          videoUrl: { type: "string", description: "Verified public HTTPS video URL to direct post with PULL_FROM_URL" },
          mimeType: { type: "string", enum: ["video/mp4", "video/quicktime", "video/webm"], description: "Optional video MIME type" },
          caption: { type: "string", description: "TikTok caption/title, up to 2200 UTF-16 characters" },
          privacyLevel: {
            type: "string",
            enum: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"],
            description: "Privacy level returned by tiktok_creator_info. Defaults to SELF_ONLY.",
          },
          disableComment: { type: "boolean", description: "Disable comments on the post" },
          disableDuet: { type: "boolean", description: "Disable duets on the post" },
          disableStitch: { type: "boolean", description: "Disable stitches on the post" },
          videoCoverTimestampMs: { type: "number", description: "Optional cover frame timestamp in milliseconds" },
          brandContentToggle: { type: "boolean", description: "True for paid partnership content" },
          brandOrganicToggle: { type: "boolean", description: "True for creator-owned business promotion" },
          isAigc: { type: "boolean", description: "True if the video should be labeled AI-generated" },
          confirmPost: { type: "boolean", description: "Must be true for live posting" },
          dryRun: { type: "boolean", description: "Validate and preview without posting" },
        },
      },
    },
    {
      name: "tiktok_video_upload",
      description:
        "Upload a video to the authorized user's TikTok inbox using Content Posting API video.upload. The creator must finish captioning/posting in TikTok.",
      inputSchema: {
        type: "object",
        properties: {
          videoPath: { type: "string", description: "Local video file path to upload with FILE_UPLOAD" },
          videoUrl: { type: "string", description: "Verified public HTTPS video URL to upload with PULL_FROM_URL" },
          mimeType: { type: "string", enum: ["video/mp4", "video/quicktime", "video/webm"], description: "Optional video MIME type" },
          caption: {
            type: "string",
            description: "Optional caption draft for preview only; TikTok video.upload captions are completed in TikTok",
          },
          dryRun: { type: "boolean", description: "Validate and preview without uploading" },
        },
      },
    },
    {
      name: "tiktok_fetch_status",
      description: "Fetch TikTok Content Posting API status for a publish_id returned by tiktok_video_upload",
      inputSchema: {
        type: "object",
        properties: {
          publishId: { type: "string", description: "TikTok publish_id returned by video upload" },
        },
        required: ["publishId"],
      },
    },
    {
      name: "youtube_video_upload",
      description:
        "Upload a hosted HTTPS video to YouTube with title, description, privacy, tags, schedule, and optional thumbnail.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "YouTube title, max 100 characters" },
          description: { type: "string", description: "YouTube description, max 5000 characters" },
          videoUrl: { type: "string", description: "Public HTTPS video URL" },
          thumbnailUrl: { type: "string", description: "Optional public HTTPS JPEG/PNG thumbnail URL" },
          mimeType: { type: "string", enum: ["video/mp4", "video/quicktime"], description: "Optional video MIME type" },
          thumbnailMimeType: { type: "string", enum: ["image/jpeg", "image/png"], description: "Optional thumbnail MIME type" },
          privacy: { type: "string", enum: ["private", "unlisted", "public"], description: "Defaults to private" },
          tags: { type: "array", items: { type: "string" }, description: "Optional YouTube tags" },
          categoryId: { type: "string", description: "Optional YouTube category id; defaults to 22" },
          madeForKids: { type: "boolean", description: "Self-declared made-for-kids flag" },
          publishAt: { type: "string", description: "Optional ISO datetime for scheduled private uploads" },
          confirmPost: { type: "boolean", description: "Must be true for live upload" },
          dryRun: { type: "boolean", description: "Validate and preview without uploading" },
        },
        required: ["title", "videoUrl"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case "social_list_supported_platforms":
        result = socialListSupportedPlatforms();
        break;
      case "social_validate_post":
        result = socialValidatePost((args ?? {}) as ValidationArgs);
        break;
      case "social_check_publish_ready":
        result = socialCheckPublishReady((args ?? {}) as { platform?: string });
        break;
      case "social_publish_direct":
        result = await socialPublishDirect((args ?? {}) as DirectPublishArgs);
        break;
      case "twitter_post":
        result = await twitterPost(args?.text as string, {
          images: args?.images as string[],
          dryRun: args?.dryRun as boolean,
        });
        break;
      case "twitter_thread":
        result = await twitterThread(args?.tweets as string[], {
          dryRun: args?.dryRun as boolean,
        });
        break;
      case "linkedin_post":
        result = await linkedinPost(args?.text as string, {
          dryRun: args?.dryRun as boolean,
        });
        break;
      case "facebook_post":
        result = await facebookPost(args?.text as string, {
          page: args?.page as string,
          pageId: args?.pageId as string,
          dryRun: args?.dryRun as boolean,
        });
        break;
      case "facebook_list_pages":
        result = await facebookListPages();
        break;
      case "instagram_post":
        result = await instagramPost(args?.imageUrl as string, args?.caption as string, {
          account: args?.account as string,
          dryRun: args?.dryRun as boolean,
        });
        break;
      case "instagram_reel_create_container":
        result = await instagramReelCreateContainer({
          videoUrl: args?.videoUrl as string,
          caption: args?.caption as string,
          mimeType: args?.mimeType as string,
          coverUrl: args?.coverUrl as string,
          thumbOffset: args?.thumbOffset as number,
          shareToFeed: args?.shareToFeed as boolean,
          account: args?.account as string,
          confirmCreate: args?.confirmCreate as boolean,
          dryRun: args?.dryRun as boolean,
        });
        break;
      case "instagram_container_status":
        result = await instagramContainerStatus({
          containerId: args?.containerId as string,
          account: args?.account as string,
        });
        break;
      case "instagram_publish_container":
        result = await instagramPublishContainer({
          containerId: args?.containerId as string,
          account: args?.account as string,
          confirmPost: args?.confirmPost as boolean,
        });
        break;
      case "instagram_list_accounts":
        result = await instagramListAccounts();
        break;
      case "tiktok_creator_info":
        result = await tiktokCreatorInfo();
        break;
      case "tiktok_direct_post":
        result = await tiktokDirectPost({
          videoPath: args?.videoPath as string,
          videoUrl: args?.videoUrl as string,
          mimeType: args?.mimeType as string,
          caption: args?.caption as string,
          privacyLevel: args?.privacyLevel as string,
          disableComment: args?.disableComment as boolean,
          disableDuet: args?.disableDuet as boolean,
          disableStitch: args?.disableStitch as boolean,
          videoCoverTimestampMs: args?.videoCoverTimestampMs as number,
          brandContentToggle: args?.brandContentToggle as boolean,
          brandOrganicToggle: args?.brandOrganicToggle as boolean,
          isAigc: args?.isAigc as boolean,
          confirmPost: args?.confirmPost as boolean,
          dryRun: args?.dryRun as boolean,
        });
        break;
      case "tiktok_video_upload":
        result = await tiktokVideoUpload({
          videoPath: args?.videoPath as string,
          videoUrl: args?.videoUrl as string,
          mimeType: args?.mimeType as string,
          caption: args?.caption as string,
          dryRun: args?.dryRun as boolean,
        });
        break;
      case "tiktok_fetch_status":
        result = await tiktokFetchStatus(args?.publishId as string);
        break;
      case "youtube_video_upload":
        result = await youtubeVideoUpload({
          title: args?.title as string,
          description: args?.description as string,
          videoUrl: args?.videoUrl as string,
          thumbnailUrl: args?.thumbnailUrl as string,
          mimeType: args?.mimeType as string,
          thumbnailMimeType: args?.thumbnailMimeType as string,
          privacy: args?.privacy as string,
          tags: args?.tags as string[],
          categoryId: args?.categoryId as string,
          madeForKids: args?.madeForKids as boolean,
          publishAt: args?.publishAt as string,
          confirmPost: args?.confirmPost as boolean,
          dryRun: args?.dryRun as boolean,
        });
        break;
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    return { content: [{ type: "text", text: result }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

// =============================================================================
// ENTRY POINT
// =============================================================================

const cliArgs = process.argv.slice(2);
const isMainModule = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

// CLI mode
if (
  isMainModule &&
  cliArgs.length > 0 &&
  ["twitter", "linkedin", "facebook", "instagram", "tiktok", "youtube", "help"].includes(cliArgs[0])
) {
  const platform = cliArgs[0];
  const command = cliArgs[1];

  function parseCliArgs(args: string[]): Record<string, any> {
    const opts: Record<string, any> = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith("--")) {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          opts[key] = next;
          i++;
        } else {
          opts[key] = true;
        }
      }
    }
    return opts;
  }

  const opts = parseCliArgs(cliArgs.slice(2));

  (async () => {
    try {
      let result: string;

      if (platform === "help") {
        console.log(`
Social Media Publisher CLI

Usage: social-media-publisher <platform> <command> [options]

Platforms:
  twitter post --text "..."              Post a tweet
  twitter thread --tweets "..." "..."    Post a thread
  linkedin post --text "..."             Post to LinkedIn
  facebook list                          List available pages
  facebook post --text "..." [--page ""] Post to Facebook page
  instagram list                         List available accounts
  instagram post --image <url> --caption "..." [--account @...]
  tiktok upload --path <file>            Upload video to TikTok inbox
  tiktok upload --url <https-url>        Upload verified URL to TikTok inbox
  tiktok creator-info                    Show Direct Post creator settings
  tiktok direct-post --path <file>       Direct post video to TikTok
  tiktok status --publish-id <id>        Fetch TikTok publish status
  youtube upload --url <https-url>       Upload hosted video to YouTube

Options:
  --dry-run    Preview without posting
`);
        process.exit(0);
      }

      switch (platform) {
        case "twitter":
          if (command === "post") {
            result = await twitterPost(opts.text, { dryRun: opts["dry-run"] });
          } else if (command === "thread") {
            const tweets = cliArgs.slice(3).filter((a) => !a.startsWith("--"));
            result = await twitterThread(tweets, { dryRun: opts["dry-run"] });
          } else {
            throw new Error("Unknown twitter command. Use: post, thread");
          }
          break;
        case "linkedin":
          if (command === "post") {
            result = await linkedinPost(opts.text, { dryRun: opts["dry-run"] });
          } else {
            throw new Error("Unknown linkedin command. Use: post");
          }
          break;
        case "facebook":
          if (command === "list") {
            result = await facebookListPages();
          } else if (command === "post") {
            result = await facebookPost(opts.text, { page: opts.page, dryRun: opts["dry-run"] });
          } else {
            throw new Error("Unknown facebook command. Use: list, post");
          }
          break;
        case "instagram":
          if (command === "list") {
            result = await instagramListAccounts();
          } else if (command === "post") {
            result = await instagramPost(opts.image, opts.caption, {
              account: opts.account,
              dryRun: opts["dry-run"],
            });
          } else {
            throw new Error("Unknown instagram command. Use: list, post");
          }
          break;
        case "tiktok":
          if (command === "upload") {
            result = await tiktokVideoUpload({
              videoPath: opts.path,
              videoUrl: opts.url,
              mimeType: opts["mime-type"],
              caption: opts.caption,
              dryRun: opts["dry-run"],
            });
          } else if (command === "creator-info") {
            result = await tiktokCreatorInfo();
          } else if (command === "direct-post") {
            result = await tiktokDirectPost({
              videoPath: opts.path,
              videoUrl: opts.url,
              mimeType: opts["mime-type"],
              caption: opts.caption,
              privacyLevel: opts.privacy || opts["privacy-level"],
              disableComment: opts["disable-comment"],
              disableDuet: opts["disable-duet"],
              disableStitch: opts["disable-stitch"],
              videoCoverTimestampMs: opts["cover-ms"] ? Number(opts["cover-ms"]) : undefined,
              brandContentToggle: opts["brand-content"],
              brandOrganicToggle: opts["brand-organic"],
              isAigc: opts["ai-generated"],
              confirmPost: opts["confirm-post"],
              dryRun: opts["dry-run"],
            });
          } else if (command === "status") {
            result = await tiktokFetchStatus(opts["publish-id"]);
          } else {
            throw new Error("Unknown tiktok command. Use: upload, status");
          }
          break;
        case "youtube":
          if (command === "upload") {
            result = await youtubeVideoUpload({
              title: opts.title,
              description: opts.description,
              videoUrl: opts.url,
              thumbnailUrl: opts.thumbnail,
              mimeType: opts["mime-type"],
              thumbnailMimeType: opts["thumbnail-mime-type"],
              privacy: opts.privacy,
              tags: opts.tags ? String(opts.tags).split(",").map((tag) => tag.trim()).filter(Boolean) : undefined,
              categoryId: opts["category-id"],
              madeForKids: opts["made-for-kids"],
              publishAt: opts["publish-at"],
              confirmPost: opts["confirm-post"],
              dryRun: opts["dry-run"],
            });
          } else {
            throw new Error("Unknown youtube command. Use: upload");
          }
          break;
        default:
          throw new Error("Unknown platform");
      }

      console.log(result);
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  })();
}
// MCP mode
else if (isMainModule && (cliArgs.length === 0 || cliArgs[0] === "--mcp")) {
  const transport = new StdioServerTransport();
  server.connect(transport).catch(console.error);
}
