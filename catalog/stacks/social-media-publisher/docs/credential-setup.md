# Social Publisher Credential Setup

This stack source directory is a registry/package artifact. It should contain code, manifests, docs, tests, and examples only.

Do not store real API keys, OAuth tokens, client secrets, page access tokens, refresh tokens, or downloaded credential JSON files in:

```text
apps/registry/catalog/stacks/social-media-publisher
```

Real credentials belong in local RUDI storage:

```text
~/.rudi/secrets.json
~/.rudi/secrets/social-media-publisher.env
~/.rudi/state/stacks/social-media-publisher/platforms/meta/pages-config.json
~/.rudi/state/stacks/social-media-publisher/platforms/meta/instagram/instagram-config.json
```

Use `.env.example` only as a key list. It must not contain real values.

## Install Checklist

1. Install or sync the stack.
2. Create developer apps in each platform portal.
3. Add the local redirect URIs listed below to those developer apps.
4. Store client IDs/secrets in RUDI secrets or `~/.rudi/secrets/social-media-publisher.env`.
5. Run the OAuth login helper scripts where available.
6. Run `social_check_publish_ready` before attempting any live post.
7. Use dry runs before any live `confirmPost=true` call.

## Platform Sources

| Platform | Developer source | RUDI needs | Setup path |
| --- | --- | --- | --- |
| TikTok | [TikTok Developer Portal](https://developers.tiktok.com/doc/content-posting-api-get-started/) | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_ACCESS_TOKEN` or `TIKTOK_REFRESH_TOKEN` | Configure Login Kit and Content Posting API, add redirect URI, authorize `video.upload` and optionally `video.publish`, then store tokens locally. |
| X/Twitter | [X Developer Portal](https://developer.x.com/) | OAuth2: `TWITTER_OAUTH2_CLIENT_ID`, `TWITTER_OAUTH2_CLIENT_SECRET`, `TWITTER_OAUTH2_REFRESH_TOKEN`; or OAuth1: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` | Create an app, enable posting permissions, generate user-context credentials, then store them locally. OAuth2 refresh credentials are preferred for `social_publish_direct`. |
| LinkedIn | [LinkedIn Developer Portal](https://www.linkedin.com/developers/) | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_ACCESS_TOKEN` with `w_member_social` | Add `http://localhost:3000/auth/linkedin/callback`, then run `npm run linkedin:login`. |
| YouTube | [Google Cloud Console](https://console.cloud.google.com/) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` | Create a Desktop OAuth client, enable YouTube Data API, store client credentials, then run `npm run youtube:login`. |
| Facebook | [Meta for Developers](https://developers.facebook.com/apps/) | Facebook Page `access_token` values in `pages-config.json` | Add `http://localhost:3000/auth/meta/callback`, then run `npm run meta:login`. |
| Instagram | [Meta for Developers](https://developers.facebook.com/apps/) | Linked Instagram account IDs and Page access tokens in `instagram-config.json` | Use the same Meta app/login flow. The helper discovers linked Instagram professional accounts from `/me/accounts`. |

## OAuth Helpers

Run these from the installed stack directory or the package source during development:

```sh
npm run linkedin:login
npm run meta:login
npm run youtube:login
```

Use `--no-open` when working in an agent session that should print the URL instead of opening a browser:

```sh
npm run linkedin:login -- --no-open
npm run meta:login -- --no-open
npm run youtube:login -- --no-open
```

Use `--dry-run --json` to confirm the generated authorization URL and requested scopes without listening for a callback or writing secrets:

```sh
npm run linkedin:login -- --dry-run --no-open --json
npm run meta:login -- --dry-run --no-open --json
npm run youtube:login -- --dry-run --no-open --json
```

## Redirect URIs

Add these exact redirect URIs to the corresponding developer apps:

```text
LinkedIn: http://localhost:3000/auth/linkedin/callback
Meta:     http://localhost:3000/auth/meta/callback
YouTube:  Desktop OAuth client loopback redirect handled by Google installed-app flow
TikTok:   Use the app-specific redirect URI configured in TIKTOK_REDIRECT_URI
```

YouTube's helper uses a local loopback callback with PKCE and a random available port.

## Required Scopes

| Platform | Scopes or permissions |
| --- | --- |
| TikTok | `video.upload`, optionally `video.publish` for direct post |
| X/Twitter | User-context write permissions; OAuth2 refresh token should include write scope and offline access |
| LinkedIn | `openid`, `profile`, `email`, `w_member_social` |
| YouTube | `https://www.googleapis.com/auth/youtube.upload`, `https://www.googleapis.com/auth/youtube.force-ssl` |
| Facebook | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` |
| Instagram | `instagram_basic`, `instagram_content_publish`, plus the Facebook Page permissions above |

## Storage Details

General secrets are stored in both global RUDI secrets and the stack env file so local scripts and MCP tools can read them:

```text
~/.rudi/secrets.json
~/.rudi/secrets/social-media-publisher.env
```

Meta Page and Instagram account tokens are stored in RUDI state config because they are per-target account config:

```text
~/.rudi/state/stacks/social-media-publisher/platforms/meta/pages-config.json
~/.rudi/state/stacks/social-media-publisher/platforms/meta/instagram/instagram-config.json
```

Those state config files may contain real Page tokens after `npm run meta:login`. Keep them out of Git.

## Readiness

Use the MCP readiness tool after configuring credentials:

```text
social_check_publish_ready
```

For YouTube, use validated readiness after OAuth setup or token refresh:

```json
{"platform":"youtube","validateAuth":true}
```

Validated readiness refreshes the local stack env values, asks Google for an access token, and looks up the authorized channel without uploading or publishing media. The response includes structured auth status and does not include secret values.

Expected fully configured platform set:

```text
tiktok
twitter
linkedin
youtube
facebook
instagram
```

If a platform is not configured, the readiness result reports the missing key group without exposing token values.

## Token Lifecycle

- TikTok, X/Twitter OAuth2, and YouTube can use refresh-token flows.
- LinkedIn access tokens may expire without returning a refresh token; rerun `npm run linkedin:login` before expiry.
- Meta long-lived user tokens and Page tokens can expire or be revoked; rerun `npm run meta:login` when readiness or live calls fail with token errors.
- Never log, paste, or commit token values. Use masked readiness checks and dry runs for diagnostics.

## Official Docs

- [TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started/)
- [X API posting](https://docs.x.com/x-api/posts/manage-tweets/integrate)
- [LinkedIn OAuth](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- [YouTube Data API OAuth](https://developers.google.com/youtube/v3/guides/auth/installed-apps)
- [YouTube videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- [Meta Facebook Login manual flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/)
- [Meta access tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/)
- [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing/)
