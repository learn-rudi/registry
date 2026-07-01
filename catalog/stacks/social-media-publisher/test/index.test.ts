import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import axios from "axios";

import {
  socialCheckPublishReady,
  socialListSupportedPlatforms,
  socialPublishDirect,
  socialValidatePost,
  tiktokDirectPost,
  tiktokVideoUpload,
  youtubeVideoUpload,
} from "../src/index.ts";

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withEnvAsync<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function mockAxios(methods: Partial<Pick<typeof axios, "get" | "post">>): () => void {
  const original = {
    get: axios.get,
    post: axios.post,
  };

  if (methods.get) axios.get = methods.get;
  if (methods.post) axios.post = methods.post;

  return () => {
    axios.get = original.get;
    axios.post = original.post;
  };
}

test("socialListSupportedPlatforms exposes the unified publisher adapters", () => {
  const result = JSON.parse(socialListSupportedPlatforms());

  assert.deepEqual(result.platforms.sort(), ["facebook", "instagram", "linkedin", "tiktok", "twitter", "youtube"]);
});

test("socialValidatePost validates a valid Twitter text post", () => {
  const result = JSON.parse(
    socialValidatePost({
      platform: "twitter",
      body: "A short post for X.",
    })
  );

  assert.equal(result.platform, "twitter");
  assert.equal(result.target.asset_type, "profile");
  assert.equal(result.validation.ok, true);
  assert.equal(result.validation.mode, "text");
});

test("socialValidatePost returns platform validation errors", () => {
  const result = JSON.parse(
    socialValidatePost({
      platform: "twitter",
      body: "x".repeat(281),
    })
  );

  assert.equal(result.validation.ok, false);
  assert.equal(result.validation.errors[0].code, "tweet_too_long");
});

test("socialCheckPublishReady reports platform readiness without exposing secret values", () => {
  const result = JSON.parse(socialCheckPublishReady({ platform: "youtube" }));

  assert.equal(result.platforms.length, 1);
  assert.equal(result.platforms[0].platform, "youtube");
  assert.equal(result.platforms[0].supported, true);
  assert.ok(Array.isArray(result.platforms[0].missing));
});

test("socialCheckPublishReady accepts Twitter OAuth2 refresh credentials", () => {
  const result = withEnv(
    {
      TWITTER_API_KEY: undefined,
      TWITTER_API_SECRET: undefined,
      TWITTER_ACCESS_TOKEN: undefined,
      TWITTER_ACCESS_SECRET: undefined,
      TWITTER_OAUTH2_ACCESS_TOKEN: undefined,
      TWITTER_OAUTH2_REFRESH_TOKEN: "refresh-token",
      TWITTER_OAUTH2_CLIENT_ID: "client-id",
      TWITTER_OAUTH2_CLIENT_SECRET: "client-secret",
    },
    () => JSON.parse(socialCheckPublishReady({ platform: "twitter" }))
  );

  assert.equal(result.platforms[0].platform, "twitter");
  assert.equal(result.platforms[0].configured, true);
  assert.deepEqual(result.platforms[0].missing, []);
});

test("socialCheckPublishReady accepts LinkedIn refresh credentials", () => {
  const result = withEnv(
    {
      LINKEDIN_ACCESS_TOKEN: undefined,
      LINKEDIN_REFRESH_TOKEN: "refresh-token",
      LINKEDIN_CLIENT_ID: "client-id",
      LINKEDIN_CLIENT_SECRET: "client-secret",
    },
    () => JSON.parse(socialCheckPublishReady({ platform: "linkedin" }))
  );

  assert.equal(result.platforms[0].platform, "linkedin");
  assert.equal(result.platforms[0].configured, true);
  assert.deepEqual(result.platforms[0].missing, []);
});

test("socialCheckPublishReady can validate YouTube auth without publishing media", async () => {
  const restoreAxios = mockAxios({
    post: async () => ({ data: { access_token: "access-token" } }),
    get: async () => ({
      data: {
        items: [
          {
            id: "UC123456",
            snippet: { title: "Hoff Digital" },
          },
        ],
      },
    }),
  });

  try {
    const result = await withEnvAsync(
      {
        YOUTUBE_REFRESH_TOKEN: "refresh-token",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
      },
      async () => JSON.parse(await socialCheckPublishReady({ platform: "youtube", validateAuth: true }))
    );

    assert.equal(result.platforms[0].platform, "youtube");
    assert.equal(result.platforms[0].configured, true);
    assert.equal(result.platforms[0].auth.checked, true);
    assert.equal(result.platforms[0].auth.ok, true);
    assert.equal(result.platforms[0].auth.provider_account_id, "UC123456");
    assert.equal(result.platforms[0].auth.display_name, "Hoff Digital");
  } finally {
    restoreAxios();
  }
});

test("socialCheckPublishReady reports invalid YouTube refresh tokens without exposing secrets", async () => {
  const restoreAxios = mockAxios({
    post: async () => {
      const error = new Error("Request failed with status code 400") as Error & {
        response?: { status: number; data: Record<string, string> };
      };
      error.response = {
        status: 400,
        data: {
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        },
      };
      throw error;
    },
  });

  try {
    const result = await withEnvAsync(
      {
        YOUTUBE_REFRESH_TOKEN: "refresh-token-secret",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
      },
      async () => JSON.parse(await socialCheckPublishReady({ platform: "youtube", validateAuth: true }))
    );

    assert.equal(result.platforms[0].platform, "youtube");
    assert.equal(result.platforms[0].configured, false);
    assert.equal(result.platforms[0].auth.checked, true);
    assert.equal(result.platforms[0].auth.ok, false);
    assert.equal(result.platforms[0].auth.code, "youtube_invalid_grant");
    assert.equal(result.platforms[0].auth.message, "Token has been expired or revoked.");
    assert.equal(result.platforms[0].auth.retryable, false);
    assert.equal(JSON.stringify(result).includes("refresh-token-secret"), false);
  } finally {
    restoreAxios();
  }
});

test("socialCheckPublishReady reloads stack env values written after module startup", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "social-publisher-env-"));
  const stackEnvPath = join(tempDir, "social-media-publisher.env");
  writeFileSync(
    stackEnvPath,
    [
      "YOUTUBE_REFRESH_TOKEN=old-refresh-token",
      "GOOGLE_CLIENT_ID=google-client-id",
      "GOOGLE_CLIENT_SECRET=google-client-secret",
      "",
    ].join("\n")
  );

  const restoreAxios = mockAxios({
    post: async (_url, body) => {
      assert.equal(typeof body?.get, "function");
      assert.equal(body.get("refresh_token"), "new-refresh-token");
      return { data: { access_token: "access-token" } };
    },
    get: async () => ({
      data: {
        items: [
          {
            id: "UC123456",
            snippet: { title: "Hoff Digital" },
          },
        ],
      },
    }),
  });

  try {
    await withEnvAsync(
      {
        SOCIAL_MEDIA_PUBLISHER_STACK_ENV_PATH: stackEnvPath,
        YOUTUBE_REFRESH_TOKEN: undefined,
        GOOGLE_CLIENT_ID: undefined,
        GOOGLE_CLIENT_SECRET: undefined,
      },
      async () => {
        const moduleUrl = `../src/index.ts?stack-env-refresh=${Date.now()}`;
        const publisher = await import(moduleUrl);

        writeFileSync(
          stackEnvPath,
          [
            "YOUTUBE_REFRESH_TOKEN=new-refresh-token",
            "GOOGLE_CLIENT_ID=google-client-id",
            "GOOGLE_CLIENT_SECRET=google-client-secret",
            "",
          ].join("\n")
        );

        const result = JSON.parse(await publisher.socialCheckPublishReady({ platform: "youtube", validateAuth: true }));

        assert.equal(result.platforms[0].configured, true);
        assert.equal(result.platforms[0].auth.ok, true);
      }
    );
  } finally {
    restoreAxios();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("socialPublishDirect supports adapter-backed dry runs without credentials", async () => {
  const result = JSON.parse(
    await socialPublishDirect({
      platform: "youtube",
      title: "A short YouTube title",
      body: "Description",
      media: [{ media_kind: "video", source_url: "https://cdn.example.com/video.mp4", mime_type: "video/mp4" }],
      metadata: { youtube: { privacy: "private" } },
      dryRun: true,
    })
  );

  assert.equal(result.dryRun, true);
  assert.equal(result.platform, "youtube");
  assert.equal(result.validation.ok, true);
  assert.equal(result.validation.mode, "video");
});

test("instagramReelCreateContainer supports dry runs before creating a Meta container", async () => {
  const publisher = await import("../src/index.ts");

  assert.equal(typeof publisher.instagramReelCreateContainer, "function");

  const result = JSON.parse(
    await publisher.instagramReelCreateContainer({
      videoUrl: "https://cdn.example.com/reel.mp4",
      caption: "Caption",
      dryRun: true,
    })
  );

  assert.equal(result.dryRun, true);
  assert.equal(result.platform, "instagram");
  assert.equal(result.action, "create_reel_container");
  assert.equal(result.validation.ok, true);
  assert.equal(result.validation.mode, "reel");
});

test("socialPublishDirect requires explicit confirmation outside dry runs", async () => {
  await assert.rejects(
    () =>
      socialPublishDirect({
        platform: "twitter",
        body: "A short post for X.",
      }),
    /confirmPost must be true/
  );
});

test("tiktokVideoUpload supports local video dry runs", async () => {
  const result = await tiktokVideoUpload({
    videoPath: "/tmp/video.mp4",
    mimeType: "video/mp4",
    caption: "Draft caption",
    dryRun: true,
  });

  assert.match(result, /DRY RUN - TikTok Inbox Video Upload/);
  assert.match(result, /Mode: inbox_file_upload/);
  assert.match(result, /Video path: \/tmp\/video\.mp4/);
});

test("tiktokDirectPost requires explicit confirmation outside dry runs", async () => {
  await assert.rejects(
    () =>
      tiktokDirectPost({
        videoPath: "/tmp/video.mp4",
        caption: "Direct post caption",
      }),
    /confirmPost must be true/
  );
});

test("tiktokDirectPost supports local video dry runs", async () => {
  const result = await tiktokDirectPost({
    videoPath: "/tmp/video.mp4",
    mimeType: "video/mp4",
    caption: "Direct post caption",
    privacyLevel: "SELF_ONLY",
    dryRun: true,
  });

  assert.match(result, /DRY RUN - TikTok Direct Post/);
  assert.match(result, /Privacy: SELF_ONLY/);
});

test("youtubeVideoUpload supports hosted video dry runs", async () => {
  const result = JSON.parse(
    await youtubeVideoUpload({
      title: "A short YouTube title",
      description: "Description",
      videoUrl: "https://cdn.example.com/video.mp4",
      mimeType: "video/mp4",
      privacy: "private",
      dryRun: true,
    })
  );

  assert.equal(result.dryRun, true);
  assert.equal(result.platform, "youtube");
  assert.equal(result.validation.ok, true);
  assert.equal(result.validation.mode, "video");
});

test("youtubeVideoUpload requires explicit confirmation outside dry runs", async () => {
  await assert.rejects(
    () =>
      youtubeVideoUpload({
        title: "A short YouTube title",
        videoUrl: "https://cdn.example.com/video.mp4",
        mimeType: "video/mp4",
      }),
    /confirmPost must be true/
  );
});
