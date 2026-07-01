import assert from 'node:assert/strict';
import test from 'node:test';

import axios from 'axios';

import { youtubeChannelAdapter } from '../../src/adapters/youtube-channel.js';

const target = Object.freeze({
  asset_type: 'channel',
  platform_asset_id: 'UC123',
});

function post(overrides = {}) {
  return {
    title: 'YouTube smoke upload',
    body: 'YouTube smoke description',
    metadata: {},
    ...overrides,
  };
}

function video(overrides = {}) {
  return {
    media_kind: 'video',
    source_url: 'https://example.com/video.mp4',
    mime_type: 'video/mp4',
    bytes: 1024,
    ...overrides,
  };
}

function thumbnail(overrides = {}) {
  return {
    media_kind: 'image',
    source_url: 'https://example.com/thumbnail.jpg',
    mime_type: 'image/jpeg',
    bytes: 1024,
    ...overrides,
  };
}

const token = JSON.stringify({
  refreshToken: 'refresh-token',
  tokenUri: 'https://oauth2.googleapis.com/token',
});

function setGoogleEnv() {
  const previous = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  };

  process.env.GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';

  return previous;
}

function restoreGoogleEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function mockAxios(methods) {
  const original = {
    delete: axios.delete,
    get: axios.get,
    post: axios.post,
    put: axios.put,
  };

  axios.delete = methods.delete ?? (async () => ({ data: {} }));
  axios.get = methods.get ?? (async () => ({ data: {} }));
  axios.post = methods.post ?? (async () => ({ data: { access_token: 'access-token' } }));
  axios.put = methods.put ?? (async () => ({ data: {} }));

  return () => {
    axios.delete = original.delete;
    axios.get = original.get;
    axios.post = original.post;
    axios.put = original.put;
  };
}

test('youtube adapter validates private video uploads', () => {
  const result = youtubeChannelAdapter.validatePost({
    post: post(),
    target,
    media: [video()],
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'video');
});

test('youtube adapter validates video uploads with thumbnail', () => {
  const result = youtubeChannelAdapter.validatePost({
    post: post(),
    target,
    media: [video(), thumbnail()],
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'video_with_thumbnail');
});

test('youtube adapter rejects missing titles', () => {
  const result = youtubeChannelAdapter.validatePost({
    post: post({ title: '', metadata: { youtube: { title: '' } } }),
    target,
    media: [video()],
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'missing_title');
});

test('youtube adapter rejects non-HTTPS video URLs', () => {
  const result = youtubeChannelAdapter.validatePost({
    post: post(),
    target,
    media: [video({ source_url: 'http://example.com/video.mp4' })],
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'media_url_not_https');
});

test('youtube adapter rejects unsupported privacy status', () => {
  const result = youtubeChannelAdapter.validatePost({
    post: post({ metadata: { youtube: { privacy: 'friends' } } }),
    target,
    media: [video()],
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'invalid_privacy_status');
});

test('youtube adapter rejects multiple videos', () => {
  const result = youtubeChannelAdapter.validatePost({
    post: post(),
    target,
    media: [video(), video()],
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'one_video_required');
});

test('youtube adapter updates video metadata with writable fields only', async () => {
  const previousEnv = setGoogleEnv();
  let updateBody;
  let updateParams;
  const restoreAxios = mockAxios({
    get: async () => ({
      data: {
        items: [{
          id: 'abc123_XYZ',
          snippet: {
            title: 'Old title',
            description: 'Old description',
            tags: ['old'],
            categoryId: '22',
            thumbnails: { default: { url: 'https://example.com/default.jpg' } },
          },
          status: {
            privacyStatus: 'private',
            uploadStatus: 'processed',
            embeddable: true,
          },
        }],
      },
    }),
    put: async (url, body, config) => {
      updateBody = body;
      updateParams = config.params;
      return {
        data: {
          id: body.id,
          snippet: body.snippet,
          status: body.status,
        },
      };
    },
  });

  try {
    const result = await youtubeChannelAdapter.updatePost({
      platformPostId: 'abc123_XYZ',
      post: post({
        title: 'Updated title',
        body: 'Updated description',
        metadata: {
          youtube: {
            tags: ['rudi', 'youtube'],
            privacy: 'unlisted',
          },
        },
      }),
      token,
    });

    assert.equal(result.platformPostId, 'abc123_XYZ');
    assert.equal(updateParams.part, 'snippet,status');
    assert.equal(updateBody.snippet.title, 'Updated title');
    assert.equal(updateBody.snippet.description, 'Updated description');
    assert.deepEqual(updateBody.snippet.tags, ['rudi', 'youtube']);
    assert.equal(updateBody.snippet.thumbnails, undefined);
    assert.equal(updateBody.status.privacyStatus, 'unlisted');
    assert.equal(updateBody.status.uploadStatus, undefined);
  } finally {
    restoreAxios();
    restoreGoogleEnv(previousEnv);
  }
});

test('youtube adapter deletes a video by id', async () => {
  const previousEnv = setGoogleEnv();
  let deletedId;
  const restoreAxios = mockAxios({
    delete: async (url, config) => {
      deletedId = config.params.id;
      return { data: {} };
    },
  });

  try {
    const result = await youtubeChannelAdapter.deletePost({
      platformPostId: 'abc123_XYZ',
      token,
    });

    assert.equal(result.platformPostId, 'abc123_XYZ');
    assert.equal(result.platformResponse.deleted, true);
    assert.equal(deletedId, 'abc123_XYZ');
  } finally {
    restoreAxios();
    restoreGoogleEnv(previousEnv);
  }
});

test('youtube adapter maps OAuth invalid_grant token refresh errors to actionable auth errors', async () => {
  const previousEnv = setGoogleEnv();
  const restoreAxios = mockAxios({
    post: async () => {
      const error = new Error('Request failed with status code 400');
      error.response = {
        status: 400,
        data: {
          error: 'invalid_grant',
          error_description: 'Token has been expired or revoked.',
        },
      };
      throw error;
    },
  });

  try {
    await assert.rejects(
      () => youtubeChannelAdapter.checkAuth({ target, token }),
      (error) => {
        assert.equal(error.name, 'PlatformAdapterError');
        assert.equal(error.code, 'youtube_invalid_grant');
        assert.equal(error.message, 'Token has been expired or revoked.');
        assert.equal(error.retryable, false);
        assert.equal(error.details.status, 400);
        assert.equal(error.details.reason, 'invalid_grant');
        return true;
      },
    );
  } finally {
    restoreAxios();
    restoreGoogleEnv(previousEnv);
  }
});

test('youtube adapter updates thumbnails with hosted image media', async () => {
  const previousEnv = setGoogleEnv();
  let uploadedThumbnailVideoId;
  const restoreAxios = mockAxios({
    get: async () => ({ data: Buffer.from('thumbnail-bytes') }),
    post: async (url, body, config) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return { data: { access_token: 'access-token' } };
      }

      uploadedThumbnailVideoId = config.params.videoId;
      return { data: { kind: 'youtube#thumbnailSetResponse' } };
    },
  });

  try {
    const result = await youtubeChannelAdapter.updateThumbnail({
      platformPostId: 'abc123_XYZ',
      thumbnail: thumbnail(),
      token,
    });

    assert.equal(result.platformPostId, 'abc123_XYZ');
    assert.equal(result.platformResponse.thumbnail_uploaded, true);
    assert.equal(uploadedThumbnailVideoId, 'abc123_XYZ');
  } finally {
    restoreAxios();
    restoreGoogleEnv(previousEnv);
  }
});
