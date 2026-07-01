# Social Media Publisher Stack

MCP tools for direct social posting plus a reusable unified publisher core for queued, multi-platform publishing.

For platform developer portal setup, required OAuth scopes, redirect URIs, and local secret storage rules, see [docs/credential-setup.md](docs/credential-setup.md).

## Activation Modes

`social_list_supported_platforms` and `social_validate_post` do not require secrets.

Direct MCP posting tools use these credentials:

| Tool | Required activation |
| --- | --- |
| `social_check_publish_ready` | No secrets; reports local readiness without exposing token values |
| `social_publish_direct` | Platform credential for selected destination; live calls require `confirmPost=true`; X supports OAuth2 refresh credentials, OAuth2 access token, or OAuth1 user credentials |
| `twitter_post`, `twitter_thread` | `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` |
| `linkedin_post` | `LINKEDIN_ACCESS_TOKEN`, or `LINKEDIN_REFRESH_TOKEN` plus `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` |
| `facebook_post`, `facebook_list_pages` | Facebook pages config JSON in RUDI state |
| `instagram_post`, `instagram_list_accounts` | Instagram accounts config JSON in RUDI state and public HTTPS media URLs |
| `tiktok_video_upload`, `tiktok_direct_post`, `tiktok_creator_info`, `tiktok_fetch_status` | `TIKTOK_ACCESS_TOKEN`, or `TIKTOK_REFRESH_TOKEN` plus `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` |
| `youtube_video_upload` | `YOUTUBE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and public HTTPS video media |

TikTok supports two Content Posting API modes. `tiktok_video_upload` sends a local video file or verified HTTPS video URL to the creator's TikTok inbox; the creator must open the TikTok inbox notification to finish editing, captioning, and posting. `tiktok_direct_post` uses `video.publish` to submit the post directly. TikTok may restrict unaudited sandbox/direct-post clients to private visibility.

Most non-TikTok media publishing paths require the rendered image/video to be available at a public HTTPS URL before posting. The video editor can produce the final local render, then a media hosting step must make that render available to Facebook, Instagram, LinkedIn, Twitter/X, or YouTube.

Unified queued publishing uses the API/worker, database, encrypted token store, and platform import scripts. At minimum it needs `DATABASE_URL` or `DIRECT_DATABASE_URL`, plus `TOKEN_ENCRYPTION_KEY`.

## RUDI Secrets

Configure only the credentials you need:

```sh
rudi secrets set TWITTER_API_KEY "<value>"
rudi secrets set TWITTER_API_SECRET "<value>"
rudi secrets set TWITTER_ACCESS_TOKEN "<value>"
rudi secrets set TWITTER_ACCESS_SECRET "<value>"
rudi secrets set TWITTER_OAUTH2_CLIENT_ID "<value>"
rudi secrets set TWITTER_OAUTH2_CLIENT_SECRET "<value>"
rudi secrets set TWITTER_OAUTH2_REFRESH_TOKEN "<value>"
rudi secrets set LINKEDIN_CLIENT_ID "<value>"
rudi secrets set LINKEDIN_CLIENT_SECRET "<value>"
rudi secrets set LINKEDIN_ACCESS_TOKEN "<value>"
rudi secrets set META_APP_ID "<value>"
rudi secrets set META_APP_SECRET "<value>"
rudi secrets set YOUTUBE_REFRESH_TOKEN "<value>"
rudi secrets set GOOGLE_CLIENT_ID "<value>"
rudi secrets set GOOGLE_CLIENT_SECRET "<value>"
rudi secrets set TIKTOK_ACCESS_TOKEN "<value>"
rudi secrets set TIKTOK_REFRESH_TOKEN "<value>"
rudi secrets set DATABASE_URL "<value>"
rudi secrets set TOKEN_ENCRYPTION_KEY "<value>"
```

Optional import-flow secrets:

```text
TWITTER_OAUTH2_ACCESS_TOKEN
TWITTER_OAUTH2_REFRESH_TOKEN
TWITTER_OAUTH2_CLIENT_ID
TWITTER_OAUTH2_CLIENT_SECRET
TWITTER_OAUTH2_TOKEN_URI
LINKEDIN_REFRESH_TOKEN
LINKEDIN_CLIENT_ID
LINKEDIN_CLIENT_SECRET
LINKEDIN_TOKEN_URI
DIRECT_DATABASE_URL
INTERNAL_API_KEY
META_APP_ID
META_APP_SECRET
META_REDIRECT_URI
META_SCOPES
META_USER_ACCESS_TOKEN
META_INSTAGRAM_APP_ID
META_INSTAGRAM_APP_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
YOUTUBE_TOKEN_URI
YOUTUBE_SCOPES
TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET
TIKTOK_REDIRECT_URI
TIKTOK_SCOPE
```

LinkedIn app credentials alone are not enough to publish. Complete the 3-legged OAuth flow with `w_member_social` and save the resulting `LINKEDIN_ACCESS_TOKEN`; if LinkedIn returns a programmatic refresh token, also save `LINKEDIN_REFRESH_TOKEN`.

Connect LinkedIn once to mint and store `LINKEDIN_ACCESS_TOKEN`:

```sh
npm run linkedin:login
```

The login helper opens LinkedIn consent in the system browser, listens on the configured localhost callback, validates `/v2/userinfo`, and saves the access token into RUDI local secrets plus `~/.rudi/secrets/social-media-publisher.env`. The default redirect URI is `http://localhost:3000/auth/linkedin/callback`; it must be present in the LinkedIn app's authorized redirect URLs. Use `--no-open` to print the URL instead of opening the browser.

## Meta Config

Facebook and Instagram direct tools read local account config from RUDI state, not from the package install:

```text
~/.rudi/state/stacks/social-media-publisher/platforms/meta/pages-config.json
~/.rudi/state/stacks/social-media-publisher/platforms/meta/instagram/instagram-config.json
```

Connect Meta once to mint and store Page tokens for Facebook and linked Instagram accounts:

```sh
npm run meta:login
```

The login helper opens Meta consent in the system browser, listens on the configured localhost callback, exchanges the user token to a long-lived token, fetches `/me/accounts`, then updates both Meta config files with Page access tokens. The default redirect URI is `http://localhost:3000/auth/meta/callback`; it must be present in the Meta app's valid OAuth redirect URI settings. Use `--no-open` to print the URL instead of opening the browser.

`pages-config.json` shape:

```json
{
  "pages": [
    {
      "name": "Example Page",
      "page_id": "1234567890",
      "access_token": "<facebook-page-access-token>",
      "active": true
    }
  ]
}
```

`instagram-config.json` shape:

```json
{
  "accounts": [
    {
      "facebook_page_name": "Example Page",
      "facebook_page_id": "1234567890",
      "instagram_username": "example",
      "instagram_account_id": "17800000000000000",
      "access_token": "<instagram-page-access-token>",
      "active": true
    }
  ]
}
```

## Unified Publisher

After configuring database and token encryption secrets:

```sh
npm run db:migrate
npm run import:twitter
npm run import:linkedin
npm run import:meta
npm run import:youtube
npm run api
npm run publish-worker
```

## Direct Publishing

Check which platforms are ready from local config:

```sh
npm start -- --mcp
```

MCP tools:

```text
social_check_publish_ready
social_publish_direct
instagram_reel_create_container
instagram_container_status
instagram_publish_container
youtube_video_upload
```

`social_publish_direct` uses the same adapter contract as the queued publisher. It accepts `platform`, `body`, optional `title`, optional `target`, `media`, platform-keyed `metadata`, and requires `confirmPost=true` for live publishing. Use `dryRun=true` first to validate payload shape without credentials or network posting.

For Instagram Reels, prefer the staged tools when media processing may outlive a single MCP tool call:

1. `instagram_reel_create_container` with `confirmCreate=true`
2. `instagram_container_status` until `status_code` is `FINISHED`
3. `instagram_publish_container` with `confirmPost=true`

Retry status/publish with the returned container id. Do not retry container creation after a container id is returned unless you intentionally want a new container.

For video workflows:

- TikTok inbox upload can use a local `videoPath`.
- TikTok direct post can use a local `videoPath`, but public posting may require app audit.
- YouTube, Instagram, Facebook, LinkedIn, and Twitter/X media posts require public HTTPS `source_url` media.

## TikTok Inbox Upload

Upload a local rendered MP4/MOV/WEBM into TikTok's inbox:

```sh
npm start -- tiktok upload --path /path/to/final.mp4
```

Check upload status:

```sh
npm start -- tiktok status --publish-id "v_inbox_file~v2.example"
```

The MCP tools are:

```text
tiktok_creator_info
tiktok_direct_post
tiktok_video_upload
tiktok_fetch_status
```

`tiktok_video_upload` accepts either `videoPath` for local `FILE_UPLOAD` or `videoUrl` for TikTok `PULL_FROM_URL`. For `videoUrl`, TikTok requires the domain or URL prefix to be verified in the developer app. Captions are not sent by this upload endpoint; keep the caption in your workflow copy file and complete it in TikTok after the inbox notification appears.

Direct post creator settings:

```sh
npm start -- tiktok creator-info
```

Direct post a local rendered video. This is externally visible account activity, so the CLI requires `--confirm-post` for live posts:

```sh
npm start -- tiktok direct-post \
  --path /path/to/final.mp4 \
  --caption "Caption text #hashtags" \
  --privacy SELF_ONLY \
  --confirm-post
```

`tiktok_direct_post` validates the selected privacy level against TikTok's latest `privacy_level_options` from `tiktok_creator_info`. It defaults to `SELF_ONLY` when available.

Sandbox test notes: `docs/tiktok-publishing-test-2026-06-07.md`.

## YouTube Upload

`youtube_video_upload` uploads a hosted HTTPS video URL. It supports:

- `title`
- `description`
- `privacy`: `private`, `unlisted`, or `public`
- `tags`
- `categoryId`
- `madeForKids`
- `publishAt` for scheduled private uploads
- optional HTTPS `thumbnailUrl`

Connect YouTube once to mint and store `YOUTUBE_REFRESH_TOKEN`:

```sh
npm run youtube:login
```

The login helper opens Google consent in the system browser, listens on a localhost callback, requests the configured YouTube upload scopes, and saves the refresh token into RUDI local secrets plus `~/.rudi/secrets/social-media-publisher.env`. Use `--no-open` to print the URL instead of opening the browser.

Dry run:

```sh
npm start -- youtube upload \
  --url https://cdn.example.com/final.mp4 \
  --title "Video title" \
  --description "Video description" \
  --privacy private \
  --dry-run
```

Live upload:

```sh
npm start -- youtube upload \
  --url https://cdn.example.com/final.mp4 \
  --title "Video title" \
  --description "Video description" \
  --privacy private \
  --confirm-post
```

Optional non-secret configuration:

```text
SOCIAL_MEDIA_CONFIG_DIR
META_PAGES_CONFIG_PATH
INSTAGRAM_CONFIG_PATH
LINKEDIN_API_VERSION
LINKEDIN_REDIRECT_URI
LINKEDIN_SCOPES
TOKEN_ENCRYPTION_KEY_VERSION
YOUTUBE_MAX_UPLOAD_BYTES
TIKTOK_MAX_UPLOAD_BYTES
TIKTOK_UPLOAD_CHUNK_BYTES
YOUTUBE_TOKEN_URI
YOUTUBE_SCOPES
PUBLISH_WORKER_IDLE_MS
PORT
LOG_LEVEL
NODE_ENV
RAILWAY_SERVICE_NAME
DB_POOL_MAX
DB_IDLE_TIMEOUT_MS
DB_CONNECTION_TIMEOUT_MS
BOOTSTRAP_ORGANIZATION_SUBJECT
BOOTSTRAP_ORGANIZATION_NAME
BOOTSTRAP_ORGANIZATION_SLUG
BOOTSTRAP_USER_SUBJECT
BOOTSTRAP_USER_EMAIL
BOOTSTRAP_USER_DISPLAY_NAME
```
